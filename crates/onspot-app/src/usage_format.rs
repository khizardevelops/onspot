// SPDX-License-Identifier: AGPL-3.0-or-later

//! Locale-independent parts of the usage display contract, ported from
//! `src/lib/usage/format.ts` (the driver keeps `Intl` formatting).

/// How usage numbers read on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageUnit {
    Requests,
    Tokens,
    Seconds,
    Characters,
}

/// A duration in hours and minutes, e.g. `7 h 58 min` or `45 s`.
pub fn format_duration(seconds: f64) -> String {
    let whole = seconds.max(0.0).floor() as u64;
    if whole < 60 {
        return format!("{whole} s");
    }
    let hours = whole / 3_600;
    let minutes = (whole % 3_600) / 60;
    if hours == 0 {
        format!("{minutes} min")
    } else if minutes == 0 {
        format!("{hours} h")
    } else {
        format!("{hours} h {minutes} min")
    }
}

/// A whole number with grouping, e.g. `196,400`.
pub fn format_count(value: f64) -> String {
    let rounded = value.floor().max(0.0) as u64;
    let digits = rounded.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// A quantity with its unit.
pub fn format_quantity(value: f64, unit: UsageUnit) -> String {
    if unit == UsageUnit::Seconds {
        return format_duration(value);
    }
    let rounded = value.floor() as u64;
    let (singular, plural) = match unit {
        UsageUnit::Requests => ("request", "requests"),
        UsageUnit::Tokens => ("token", "tokens"),
        UsageUnit::Characters => ("character", "characters"),
        UsageUnit::Seconds => unreachable!(),
    };
    format!(
        "{} {}",
        format_count(rounded as f64),
        if rounded == 1 { singular } else { plural }
    )
}

/// A part of a whole, split so the part can be emphasised.
pub fn format_portion(part: f64, whole: f64, unit: UsageUnit) -> (String, String) {
    if unit == UsageUnit::Seconds {
        return (
            format_duration(part),
            format!("of {}", format_duration(whole)),
        );
    }
    let plural = match unit {
        UsageUnit::Requests => "requests",
        UsageUnit::Tokens => "tokens",
        UsageUnit::Characters => "characters",
        UsageUnit::Seconds => unreachable!(),
    };
    (
        format_count(part),
        format!("of {} {plural}", format_count(whole)),
    )
}

/// When a limit starts over: a relative time within a day, `now` once passed.
pub fn format_reset(timestamp: u64, now: u64) -> String {
    let until = timestamp.saturating_sub(now);
    if until == 0 {
        return String::from("now");
    }
    if until < 24 * 3_600 * 1_000 {
        format!("in {}", format_duration(until as f64 / 1_000.0))
    } else {
        // Beyond a day the driver renders a locale date.
        String::from("later")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_match_the_ts_contract() {
        assert_eq!(format_duration(45.0), "45 s");
        assert_eq!(format_duration(3_600.0), "1 h");
        assert_eq!(format_duration(28_680.0), "7 h 58 min");
        assert_eq!(format_duration(-1.0), "0 s");
    }

    #[test]
    fn quantities_pluralise() {
        assert_eq!(format_quantity(1.0, UsageUnit::Requests), "1 request");
        assert_eq!(format_quantity(2.0, UsageUnit::Tokens), "2 tokens");
        assert_eq!(format_count(196_400.0), "196,400");
        assert_eq!(format_quantity(90.0, UsageUnit::Seconds), "1 min");
    }

    #[test]
    fn portions_and_resets_read_correctly() {
        assert_eq!(
            format_portion(7.0, 8.0, UsageUnit::Tokens),
            (String::from("7"), String::from("of 8 tokens"))
        );
        assert_eq!(format_reset(1_000, 1_000), "now");
        assert_eq!(format_reset(61_000, 1_000), "in 1 min");
    }
}
