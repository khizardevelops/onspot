// SPDX-License-Identifier: AGPL-3.0-or-later

// Rebuilds the binary v0.2.4 fixture from its tracked `v9.sql` source when the
// binary is missing, so a fresh clone does not depend on the fixture being
// committed (the repository's `.gitignore` excludes `*.sqlite`).
//
// The test binaries run in parallel, so creation uses a lock file and an
// atomic rename: a reader either sees the finished fixture or waits.


pub fn ensure_v024_fixture() -> std::path::PathBuf {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let fixture = directory.join("onspot-v0.2.4.sqlite");
    if fixture.exists() {
        return fixture;
    }

    let lock = directory.join("onspot-v0.2.4.sqlite.lock");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .is_err()
    {
        if fixture.exists() || std::time::Instant::now() > deadline {
            return fixture;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    // Only the lock holder builds it; everyone else waited above.
    if !fixture.exists() {
        let sql = std::fs::read_to_string(directory.join("v9.sql"))
            .expect("tests/fixtures/v9.sql is the fixture source and must be tracked");
        let temporary = directory.join(format!(
            "onspot-v0.2.4.{}.tmp.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&temporary);
        let connection = rusqlite::Connection::open(&temporary).expect("create the fixture");
        connection.execute_batch(&sql).expect("apply v9.sql");
        drop(connection);
        std::fs::rename(&temporary, &fixture).expect("install the fixture");
    }

    let _ = std::fs::remove_file(&lock);
    fixture
}
