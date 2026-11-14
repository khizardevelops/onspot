// SPDX-License-Identifier: AGPL-3.0-or-later

//! First-run guide state, ported from `src/lib/onboarding.ts`.

use serde::{Deserialize, Serialize};

/// Whether the guide was finished or skipped on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnboardingStatus {
    Done,
    Skipped,
}

/// Parses a stored value; anything else means the guide has not been answered.
pub fn parse_onboarding_status(stored: Option<&str>) -> Option<OnboardingStatus> {
    match stored {
        Some("done") => Some(OnboardingStatus::Done),
        Some("skipped") => Some(OnboardingStatus::Skipped),
        _ => None,
    }
}

/// True until the guide has been finished or skipped.
pub fn should_offer_onboarding(stored: Option<&str>) -> bool {
    parse_onboarding_status(stored).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_recorded_answers_close_the_guide() {
        assert!(!should_offer_onboarding(Some("done")));
        assert!(!should_offer_onboarding(Some("skipped")));
        assert!(should_offer_onboarding(None));
        assert!(should_offer_onboarding(Some("later")));
    }
}
