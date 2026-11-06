# Security policy

## Supported versions

Security fixes are provided for the latest release in the `0.2.x` line. Older releases are not
maintained; please reproduce the problem on the latest release before reporting it.

| Version | Supported |
|---|---|
| 0.2.x | Yes |
| Earlier | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on the **Security** tab of
[the repository](https://github.com/khizardevelops/onspot/security) if it is available. If it is
not, contact the maintainer privately at [@khizardevelops](https://github.com/khizardevelops).

Please include:

- The onspot version and how you installed it (GitHub release, Flatpak, built from source, Android
  APK).
- Your operating system and browser or webview version.
- Steps to reproduce the issue.
- What you expected to happen and what actually happened.
- The impact, and any proof-of-concept you can share safely.

Never include real API keys, access tokens or personal data in a report. If you need to show a key,
redact it.

## Scope

Reports are especially welcome for:

- The Tauri shell, IPC commands and capability permissions.
- Local key storage and the way keys are kept out of the database and exports.
- Cloud sync (Google Drive and WebDAV) and the restore/import path.
- Model, voice and phonemizer downloads, including integrity checks.
- Prompt-injection or data-exfiltration risks in the LLM and speech adapters.
- The web build's cross-origin isolation and worker boundaries.

The following are generally out of scope:

- Vulnerabilities in third-party model weights or voices that are downloaded from their own hosts.
- Issues that require an already-compromised device or an attacker with physical access.
- Denial of service caused by deliberately enormous local files beyond the app's documented limits.

## Our response

This is a solo-maintained, unpaid project, so response times are best effort. I will acknowledge a
report as soon as I can, keep you informed about the fix, and credit you in the release notes if you
want to be named.

There is no bug bounty.

## Safe harbour

I will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data loss and service disruption.
- Only interact with accounts or data they own, or have explicit permission to test.
- Report the issue privately and give reasonable time to fix it before public disclosure.

## Secrets

API keys live in the browser's `localStorage` under `onspot.key.*` and are never written to the
database or exports. If you believe a key has been exposed, revoke it with the provider first, then
report the issue.
