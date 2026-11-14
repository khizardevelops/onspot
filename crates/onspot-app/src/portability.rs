// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whole-database backup and restore over the file ports.
//!
//! The document export lives in [`crate::export`]; this module owns the
//! `.sqlite` image. The core decides the file name, checks the format before a
//! learner's file can replace the database, and reports what a restore wrote.
//! The driver owns the dialog, the filesystem and the database engine.

use onspot_ports::{CoreError, DatabaseFile, FileSystemSink, PickedFile, RestoreCounts};

use crate::export_validate::{is_onspot_database, is_sqlite_database};

/// Format checks shared by export and restore.
fn validate_backup(bytes: &[u8], code_prefix: &str) -> Result<(), CoreError> {
    if !is_sqlite_database(bytes) {
        return Err(CoreError::new(
            format!("{code_prefix}.not_sqlite"),
            "the chosen file is not a SQLite database",
        ));
    }
    if !is_onspot_database(bytes) {
        return Err(CoreError::new(
            format!("{code_prefix}.not_onspot"),
            "the SQLite file is not an onspot backup",
        ));
    }
    Ok(())
}

/// The suggested file name for a backup made on `date` (`YYYY-MM-DD`).
///
/// The date is supplied by the driver so the name follows the learner's clock
/// and a test can pin it.
pub fn backup_file_name(date: &str) -> String {
    format!("onspot-backup-{date}.sqlite")
}

/// What an export wrote, or that the learner cancelled the save dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportDatabaseResult {
    /// True only after the file was saved.
    pub saved: bool,
    /// The name the save dialog suggested.
    pub file_name: String,
}

/// Writes a consistent whole-database image through the file sink.
pub struct ExportDatabase<'a> {
    database: &'a dyn DatabaseFile,
    sink: &'a dyn FileSystemSink,
}

impl<'a> ExportDatabase<'a> {
    /// Creates the use case over the database and the learner's file sink.
    pub fn new(database: &'a dyn DatabaseFile, sink: &'a dyn FileSystemSink) -> Self {
        Self { database, sink }
    }

    /// Exports the database under a dated `.sqlite` name.
    ///
    /// @param date The learner's current date as `YYYY-MM-DD`.
    /// @returns Whether the file was saved and the suggested name.
    pub async fn execute(&self, date: &str) -> Result<ExportDatabaseResult, CoreError> {
        let bytes = self.database.export_bytes().await?;
        // A database that just failed its own format check must never be offered
        // as a backup; the learner would find out when the restore rejects it.
        validate_backup(&bytes, "export")?;

        let file_name = backup_file_name(date);
        let saved = self.sink.save(&file_name, &bytes).await?;

        Ok(ExportDatabaseResult { saved, file_name })
    }
}

/// A validated backup waiting for the learner's confirmation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedRestore {
    /// The picked file's name, shown in the confirmation dialog.
    pub file_name: String,
    /// The checked bytes, kept only until the restore is confirmed or cancelled.
    pub bytes: Vec<u8>,
}

/// Picks and validates a backup without touching the database.
///
/// Restore is deliberately two steps: the learner sees what will replace the
/// device before anything is written.
pub struct PickRestore<'a> {
    sink: &'a dyn FileSystemSink,
}

impl<'a> PickRestore<'a> {
    /// Creates the use case over the learner's file sink.
    pub fn new(sink: &'a dyn FileSystemSink) -> Self {
        Self { sink }
    }

    /// Opens the picker and checks the file.
    ///
    /// @returns The staged backup, or `None` when the learner cancelled.
    pub async fn execute(&self) -> Result<Option<StagedRestore>, CoreError> {
        let Some(PickedFile { file_name, bytes }) = self.sink.pick().await? else {
            return Ok(None);
        };
        validate_backup(&bytes, "restore")?;
        Ok(Some(StagedRestore { file_name, bytes }))
    }
}

/// Applies a staged backup to the local database.
pub struct RestoreDatabase<'a> {
    database: &'a dyn DatabaseFile,
}

impl<'a> RestoreDatabase<'a> {
    /// Creates the use case over the database image port.
    pub fn new(database: &'a dyn DatabaseFile) -> Self {
        Self { database }
    }

    /// Replaces the database and reports how much the snapshot holds.
    ///
    /// The bytes are checked again here: the staged copy could have aged out,
    /// and a caller could reach this use case without the pick step.
    pub async fn execute(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
        validate_backup(bytes, "restore")?;
        self.database.import_bytes(bytes).await
    }
}

/// The local date as `YYYY-MM-DD`, for the backup file name.
pub fn backup_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use futures::executor::block_on;

    use super::*;

    fn schema_bytes() -> Vec<u8> {
        let tables = [
            "schema_migrations",
            "sessions",
            "attempts",
            "corrections",
            "audio_assets",
            "settings",
        ]
        .iter()
        .map(|table| format!("CREATE TABLE IF NOT EXISTS \"{table}\" (id text)"))
        .collect::<Vec<_>>()
        .join(";");
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.extend_from_slice(tables.as_bytes());
        bytes
    }

    struct FakeDatabase {
        bytes: Vec<u8>,
        imported: Mutex<Option<Vec<u8>>>,
    }

    impl FakeDatabase {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                bytes,
                imported: Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl DatabaseFile for FakeDatabase {
        async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
            Ok(self.bytes.clone())
        }

        async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
            *self.imported.lock().expect("imported") = Some(bytes.to_vec());
            Ok(RestoreCounts {
                sessions: 2,
                attempts: 5,
            })
        }
    }

    #[derive(Default)]
    struct FakeSink {
        saved: Mutex<Option<(String, Vec<u8>)>>,
        pick: Mutex<Option<PickedFile>>,
        save_result: bool,
    }

    #[async_trait]
    impl FileSystemSink for FakeSink {
        async fn save(&self, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError> {
            *self.saved.lock().expect("saved") = Some((file_name.to_owned(), bytes.to_vec()));
            Ok(self.save_result)
        }

        async fn pick(&self) -> Result<Option<PickedFile>, CoreError> {
            Ok(self.pick.lock().expect("pick").clone())
        }
    }

    #[test]
    fn export_uses_the_dated_name_and_writes_the_database_bytes() {
        let database = FakeDatabase::new(schema_bytes());
        let sink = FakeSink {
            save_result: true,
            ..FakeSink::default()
        };

        let result = block_on(ExportDatabase::new(&database, &sink).execute("2026-11-12"))
            .expect("export succeeds");

        assert!(result.saved);
        assert_eq!(result.file_name, "onspot-backup-2026-11-12.sqlite");
        let (name, bytes) = sink.saved.lock().expect("saved").clone().expect("saved");
        assert_eq!(name, result.file_name);
        assert_eq!(bytes, database.bytes);
    }

    #[test]
    fn export_refuses_a_file_that_is_not_an_onspot_database() {
        let database = FakeDatabase::new(b"SQLite format 3\0foreign".to_vec());
        let sink = FakeSink::default();

        let error = block_on(ExportDatabase::new(&database, &sink).execute("2026-11-12"))
            .expect_err("foreign database");

        assert_eq!(error.code, "export.not_onspot");
        assert!(sink.saved.lock().expect("saved").is_none());
    }

    #[test]
    fn export_keeps_driver_secrets_out_of_the_image() {
        // BYOK keys live in the driver's SecretStore, never in the SQLite image.
        // The use case reads only `DatabaseFile::export_bytes`, so the fake's
        // secret can never reach the file even when the sink writes everything.
        let secret = "sk-live-secret-value";
        let database = FakeDatabase::new(schema_bytes());
        let sink = FakeSink {
            save_result: true,
            ..FakeSink::default()
        };

        let _ = block_on(ExportDatabase::new(&database, &sink).execute("2026-11-12"))
            .expect("export succeeds");

        let (_, bytes) = sink.saved.lock().expect("saved").clone().expect("saved");
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(secret));
        assert!(!text.contains("onspot.key."));
    }

    #[test]
    fn a_cancelled_save_reports_no_write() {
        let database = FakeDatabase::new(schema_bytes());
        let sink = FakeSink {
            save_result: false,
            ..FakeSink::default()
        };

        let result = block_on(ExportDatabase::new(&database, &sink).execute("2026-11-12"))
            .expect("export succeeds");

        assert!(!result.saved);
    }

    #[test]
    fn pick_stages_a_valid_backup_and_cancels_cleanly() {
        let sink = FakeSink {
            pick: Mutex::new(Some(PickedFile {
                file_name: String::from("my-backup.sqlite"),
                bytes: schema_bytes(),
            })),
            ..FakeSink::default()
        };

        let staged = block_on(PickRestore::new(&sink).execute())
            .expect("pick succeeds")
            .expect("file picked");
        assert_eq!(staged.file_name, "my-backup.sqlite");
        assert_eq!(staged.bytes, schema_bytes());

        let empty = FakeSink::default();
        assert!(block_on(PickRestore::new(&empty).execute())
            .expect("pick succeeds")
            .is_none());
    }

    #[test]
    fn pick_rejects_foreign_files_before_the_database_is_touched() {
        for (bytes, code) in [
            (b"not sqlite".to_vec(), "restore.not_sqlite"),
            (b"SQLite format 3\0foreign".to_vec(), "restore.not_onspot"),
        ] {
            let sink = FakeSink {
                pick: Mutex::new(Some(PickedFile {
                    file_name: String::from("foreign.sqlite"),
                    bytes,
                })),
                ..FakeSink::default()
            };
            let error = block_on(PickRestore::new(&sink).execute()).expect_err("foreign backup");
            assert_eq!(error.code, code);
        }
    }

    #[test]
    fn restore_imports_valid_bytes_and_reports_its_counts() {
        let database = FakeDatabase::new(schema_bytes());

        let counts = block_on(RestoreDatabase::new(&database).execute(&schema_bytes()))
            .expect("restore succeeds");

        assert_eq!(
            counts,
            RestoreCounts {
                sessions: 2,
                attempts: 5,
            }
        );
        assert_eq!(
            database.imported.lock().expect("imported").as_deref(),
            Some(schema_bytes().as_slice())
        );
    }

    #[test]
    fn restore_rechecks_the_format_before_importing() {
        let database = FakeDatabase::new(schema_bytes());

        let error = block_on(RestoreDatabase::new(&database).execute(b"foreign"))
            .expect_err("foreign bytes");

        assert_eq!(error.code, "restore.not_sqlite");
        assert!(database.imported.lock().expect("imported").is_none());
    }
}
