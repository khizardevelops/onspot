// SPDX-License-Identifier: AGPL-3.0-or-later

//! Reminder due-state decisions, ported from `src/lib/stores/reminders.ts`.

use serde::{Deserialize, Serialize};

const DAY_MS: u64 = 86_400_000;

/// How often the learner wants to be nudged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderFrequency {
    Frequent,
    Infrequent,
}

impl ReminderFrequency {
    /// "Frequent" is once a day; "Infrequent" is a gap of a few days.
    pub fn interval_ms(self) -> u64 {
        match self {
            Self::Frequent => DAY_MS,
            Self::Infrequent => 3 * DAY_MS,
        }
    }
}

/// The reminder view for one check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderState {
    pub ready: bool,
    pub due: bool,
    pub last_practised_at: Option<String>,
    pub next_at: Option<String>,
}

/// The times a check needs; `None` means the device has no practice record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReminderInput {
    pub enabled: bool,
    pub last_practised_at_ms: Option<u64>,
    pub snoozed_until_ms: Option<u64>,
    pub frequency: ReminderFrequency,
    pub now_ms: u64,
}

/// True when a reminder is due and has not been snoozed past now.
pub fn is_reminder_due(input: &ReminderInput) -> bool {
    let Some(last_practised_at) = input.last_practised_at_ms else {
        return false;
    };
    let due_at = last_practised_at + input.frequency.interval_ms();
    let snoozed_until = input.snoozed_until_ms.unwrap_or_default();
    input.now_ms >= due_at && input.now_ms >= snoozed_until
}

/// Builds the visible reminder state; the caller performs the I/O.
pub fn reminder_state(input: &ReminderInput) -> ReminderState {
    let due_at = input
        .last_practised_at_ms
        .map(|at| at + input.frequency.interval_ms());
    ReminderState {
        ready: true,
        due: input.enabled && is_reminder_due(input),
        last_practised_at: input.last_practised_at_ms.map(iso_utc),
        next_at: due_at.map(iso_utc),
    }
}

fn iso_utc(milliseconds: u64) -> String {
    let seconds = milliseconds / 1_000;
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

/// Howard Hinnant's civil-from-days, for a timezone-free ISO stamp.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(now: u64) -> ReminderInput {
        ReminderInput {
            enabled: true,
            last_practised_at_ms: Some(0),
            snoozed_until_ms: None,
            frequency: ReminderFrequency::Frequent,
            now_ms: now,
        }
    }

    #[test]
    fn no_practice_record_never_nudges() {
        let mut value = input(DAY_MS);
        value.last_practised_at_ms = None;
        assert!(!is_reminder_due(&value));
        assert_eq!(reminder_state(&value).next_at, None);
    }

    #[test]
    fn the_cadence_and_snooze_both_gate_the_nudge() {
        assert!(!is_reminder_due(&input(DAY_MS - 1)));
        assert!(is_reminder_due(&input(DAY_MS)));

        let mut snoozed = input(DAY_MS);
        snoozed.snoozed_until_ms = Some(DAY_MS * 2);
        assert!(!is_reminder_due(&snoozed));

        let mut disabled = input(DAY_MS);
        disabled.enabled = false;
        assert!(!reminder_state(&disabled).due);
    }

    #[test]
    fn infrequent_waits_three_days_and_the_state_is_iso_utc() {
        let mut value = input(2 * DAY_MS);
        value.frequency = ReminderFrequency::Infrequent;
        assert!(!is_reminder_due(&value));
        value.now_ms = 3 * DAY_MS;
        let state = reminder_state(&value);
        assert!(state.due);
        assert_eq!(
            state.last_practised_at.as_deref(),
            Some("1970-01-01T00:00:00.000Z")
        );
        assert_eq!(state.next_at.as_deref(), Some("1970-01-04T00:00:00.000Z"));
    }
}
