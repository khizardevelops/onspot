# Shared prompt database

Small Cloudflare Worker + D1 service that collects generated speaking prompts from clients that
have sharing enabled. Sharing is **on by default** in onspot, with a Settings opt-out. The app
queues a prompt locally first and sends it when sharing is enabled and the device is online.
Nothing else is collected: no IP address, account, device id, transcript, recording, correction or
provider key.

Deduplication is by SHA-256 of the instruction language, target language, title and text, so the
same topic from many devices is stored once. Rows start as `pending` for review; approved rows are
meant to be copied into `src/lib/practice/promptCatalogue.ts`, never served straight to clients.

The service is deployed at
**https://onspot-prompt-submissions.khizardevelops.workers.dev** (Worker
`onspot-prompt-submissions`, D1 `onspot-prompts` in APAC). The app uses that URL by default;
`VITE_PROMPT_SUBMISSIONS_URL` overrides it for a self-hosted service.

## Deploy

Configuration is `cloudflare.config.ts`, built and deployed by the `cf` CLI (install with
`bun add -g cf`). It does not use `wrangler.toml`; `cf auth login` is separate from Wrangler's login.

```sh
cd server/prompt-submissions
bun install
cf d1 list                                   # find the database id
cf d1 query <database-id> --sql "$(sed '/^--/d' schema.sql)"
cf deploy
```

`cf deploy --dry-run` validates the build and the D1 binding without uploading. To deploy a fresh
database instead, create one with `cf d1 create --name onspot-prompts`, then put its UUID in
`cloudflare.config.ts` (`bindings.d1({ name, id })`) and apply the schema as above.

## Local test

```sh
cf dev
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/ \
  -H 'content-type: application/json' \
  -d '{"consent":true,"prompts":[{"id":"test-1","title":"Morning","text":"Describe your morning.","instructionLanguage":"en","targetLanguage":"fr","level":"B1","mode":"exam","createdAt":"2026-11-11T10:00:00.000Z"}]}'
```

The second identical request reports a duplicate. A rejected payload (no `consent: true`, too
long, unknown level) returns 422 and nothing is written.

## Review

```sh
cf d1 query <database-id> --sql "SELECT title, text, instruction_language, target_language, level, mode, received_at FROM prompt_submissions WHERE status = 'pending' ORDER BY received_at"
```

Add a reviewed entry to the catalogue with an id such as `ru-topic-name`, then mark its row
`approved` (or delete it). Do not auto-publish contributed text.

Cloudflare's WAF rate limiting on this route is recommended; the Worker itself stores no IP, so it
cannot rate-limit per client.
