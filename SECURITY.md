# Security notes

## Secrets

- No credentials are committed. Keys come from the environment or a local `.env`, which is gitignored. `.env.example` has empty placeholders only.
- The keys used during the hackathon live outside this repository, in mode-600 files.
- Every commit was preceded by a scan of all tracked and untracked files for the live keys and common key patterns.
- Pushes use a deploy key scoped to this one repository.

## What the models can do

- The models never write code and never get shell, file or network tools.
- An app is a spec. `validateSpec` checks field types, keys, summary targets and filters before a fixed renderer builds anything.
- A look change is one call from a fixed set of tools on an element with a known `data-bve-id`. CSS values are checked against a safe list and text is escaped.
- Tools the server does not know are refused, both for the in-app agent and over MCP.

## Members and roles

- Each member has a random 18-byte token. Requests carry it as a bearer token.
- Owner: add, change, delete, ask, invite, change the look. Member: add, flip on/off fields, ask.
- Roles are enforced in `src/app/ops.js`, so the app's buttons, the in-app agent and MCP clients get exactly the same checks. Refused attempts are written to the activity log.
- The owner check for look changes runs before any model call.
- A look change can only be committed by the hash of a layout the server itself produced and checked, so a client cannot upload its own HTML.

## Numbers

- The agent may only write an amount that appears in what the person said or pasted. This is checked by code before the write.
- When two hearings of a voice request disagree on an amount, nothing is written until the person taps Save.

## MCP

- One endpoint per app, `POST /mcp/<appId>`. A missing or wrong token gets 401.
- The tools are `describe_app`, `add_record`, `update_record` and `query_records`. There is no delete over MCP.

## Data

- All demo data is synthetic. While free credits are in use, Meta may use submitted content to improve its products, so do not run this with real personal data.
- The studio stops recording at 15 seconds and the server refuses recordings over 1.2 MB. Recordings are sent to the Meta Model API only for transcription.
- The demo is a local server. Member tokens appear in the demo phones' URLs, which is fine on localhost and not fine on a public host.
