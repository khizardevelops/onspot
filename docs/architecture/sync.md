# Cloud sync (BYOC)

onspot can keep a copy of its database in a cloud account the learner already owns. There is no
onspot server. Sync is **manual**, **whole-database**, and **never replaces a device without an
explicit choice**.

## What moves

Sync moves the same `.sqlite` image that **Settings → Storage → Export** writes: sessions,
attempts, corrections, translations, prompts, settings, recordings and cached voice audio.

It does **not** move:

- API keys and OAuth/WebDAV credentials (device-local `localStorage`).
- Downloaded Whisper/Piper models (public files; the device fetches them again).
- `sync_metadata` is included in the file but is only bookkeeping; the receiving device rewrites
  it after a download.

## Change detection

Database files are not byte-stable: SQLite's header change counter and free pages differ on every
export even when the data is identical. Sync therefore uses a monotonic **content revision**:

| Value | Stored in | Meaning |
|---|---|---|
| `onspot.db.revision` | `localStorage` | bumped by every adapter write that changes learner data |
| `onspot.sync.synced.<provider>` | `localStorage` | the revision last synced with that provider |
| `sync_metadata` | database | remote file id, etag, last sync time, readable copy of the revision |

`sync_metadata` writes do not bump the revision. A write that lands during a transfer leaves the
device revision ahead of the synced revision, so the next sync uploads again.

## Decision table

| Local changed | Remote changed | Outcome |
|---|---|---|
| no remote file | — | **upload** (creates it) |
| no | no | **up to date** |
| yes | no | **upload** |
| no | yes | **ask** |
| yes | yes | **ask** |
| never synced with this file | — | **ask** |
| remote file deleted | — | **upload** (recreates it) |

An **ask** opens a dialog naming the device copy and the cloud copy. Uploading is safe; using the
cloud copy replaces the local database and says so before it runs. The local size is only known
after a snapshot is in memory, so the dialog shows "Stored on this device" for the local side.

## Providers

### Google Drive

| | |
|---|---|
| Scope | `https://www.googleapis.com/auth/drive.appdata` plus `openid email` for the account label |
| Location | `appDataFolder`, a hidden app-private folder; the backup does not appear in the normal Drive listing |
| Upload | resumable session + `PUT` (the database can exceed the simple-upload limit because of audio) |
| Download | `files/{id}?alt=media` |
| Change token | `md5Checksum` (falls back to `modifiedTime`) |

Authorization differs by runtime:

- **Desktop (Tauri):** OAuth 2.0 authorization-code flow with **PKCE** and a loopback redirect. A
  Rust command binds `127.0.0.1:0`, opens the system browser, captures `?code=…&state=…`, and the
  webview exchanges the code. The refresh token is kept in `localStorage`.
- **Web:** Google Identity Services token client (popup). Google's public web-client flow cannot
  exchange an authorization code without a client secret, so PKCE is not available there; the
  access token lasts about an hour and the learner reconnects when it expires. This is the one
  documented deviation from the inception's "PKCE" wording.

Client ids are build-time values (client ids are public, not secrets):

```sh
VITE_GOOGLE_CLIENT_ID_DESKTOP=…
VITE_GOOGLE_CLIENT_ID_WEB=…
```

Create a Google Cloud project, enable the Drive API, and add one OAuth client per runtime. The web
client needs the app origins (`http://localhost:5173` and the deployed origin) as authorized
JavaScript origins. See `.env.example`.

### WebDAV

Targets Nextcloud, ownCloud, pCloud and any other WebDAV server. The learner supplies the
collection URL, a path inside it, a username and a password (basic auth; app passwords work).

- **Browser:** uses the `webdav` package. The server must allow the app origin via **CORS**; most
  WebDAV servers do not by default. The UI says so.
- **Desktop / Android / iOS:** requests go through the Tauri HTTP plugin, so there is no browser
  origin policy. `webdav@5` hard-wires its own fetch, so the native path uses a small PROPFIND /
  MKCOL / PUT / GET transport over the same HTTP wrapper.

`getetag` is the change token, with `getlastmodified` and size as fallbacks.

## Credentials and settings

| Item | Where | Synced? |
|---|---|---|
| Selected provider | database `settings` | yes |
| WebDAV URL and path | database `settings` | yes |
| Google refresh token | `localStorage` (`onspot.key.google.refresh`) | no |
| WebDAV username/password | `localStorage` (`onspot.key.webdav.*`) | no |
| Google account label | `localStorage` | no |

A device that receives a database with a provider selected still has to authorize on that device;
the credentials never travel in the backup.

## Code map

| Concern | File |
|---|---|
| Provider/contract types | `src/lib/adapters/sync/types.ts` |
| Decision + orchestration | `src/lib/adapters/sync/service.ts` |
| CORS-free HTTP wrapper | `src/lib/adapters/sync/http.ts` |
| Google OAuth (desktop + web) | `src/lib/adapters/sync/google/oauth.ts` |
| Google Drive transport | `src/lib/adapters/sync/google/drive.ts` |
| WebDAV transport | `src/lib/adapters/sync/webdav.ts` |
| Provider factory | `src/lib/adapters/sync/index.ts` |
| Content revision | `src/lib/adapters/db/revision.ts` |
| Restore safety path | `src/lib/utils/export.ts` (`importSqliteBytes`) |
| Settings UI | `src/lib/components/SyncSection.svelte` |
| Conflict dialog | `src/lib/components/SyncConflictDialog.svelte` |
| Loopback redirect | `src-tauri/src/oauth.rs` |

## Limits

- Whole-file snapshots only; there is no record-level merge. Two devices that both change between
  syncs are asked to pick one copy.
- Manual only; there is no background sync or scheduled upload.
- Google Drive sync is not available in the mobile builds yet. WebDAV works there.
- A browser deployment needs CORS from a WebDAV server; the desktop and mobile apps do not.
- Sync holds the OPFS database lock like any other operation, so the web build still runs one tab
  at a time.

## Verification

Browser (Chromium, local WebDAV server with CORS): connect, first upload, no-op second sync,
remote-only conflict, cloud restore, keep-device upload, and corrupt-remote rejection. Desktop
OAuth is covered by `cargo test` for callback parsing and a real loopback request, and by
`cargo check`; a live Google account run needs the client ids above.
