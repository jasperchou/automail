# Project Instructions

## User Preferences

- Reply in Chinese by default for this repository.
- Keep changes pragmatic and simple; prefer small, verifiable patches.
- When code changes are made, run relevant tests and create a commit unless explicitly told not to.
- If currently on the `main` branch and code or project files need to change, create/switch to a task branch before editing.
- Do not commit local secrets or runtime data. `.env`, `data/`, and `node_modules/` must stay ignored.

## Service Shape

- This is a minimal automail service for receiving arbitrary mailbox addresses and exposing simple pull APIs.
- SMTP receives mail directly on port `25` on the server; do not route SMTP through Caddy.
- HTTP API is served behind Caddy at `https://mail.berich.xyz`.
- Caddy must require an API key to be present for mail API requests, and the backend must still validate the actual key.
- CORS for the mail API should remain open enough for the local viewer: allow `GET`, `OPTIONS`, and `x-api-key`.

## Storage And Containers

- Use Postgres for mail data.
- Prefer reusing an existing Postgres container/network instead of starting a duplicate database.
- On the Japan server, automail reuses the `sub2api` Postgres setup with a separate `automail` database.
- Keep data paths explicit and stable. Project runtime data should use `./data` locally unless a server `.env` overrides it.
- Do not expose or print server `.env` values unnecessarily.

## API Behavior

- API key auth is required for pull APIs.
- Mail listing must support:
  - `mailbox=all`
  - pagination with `limit` and `offset`
  - latest-first ordering
  - sender filter
  - keyword filter
  - timestamp filters with `since` and `until`
- Invalid pagination inputs should fall back safely, not propagate `NaN`.

## Structured Data Extraction

- Structured data is a backend capability and should be computed on receive.
- Keep supporting history recalculation with:

```bash
npm run backfill:structured
npm run backfill:structured -- --mailbox=jasper@mail.berich.xyz
```

- Extract these built-in item types:
  - six-digit verification codes
  - useful links the mail expects the user to click
- Do not extract image-like links or static resource links:
  - images such as `png`, `jpg`, `svg`, `webp`
  - fonts such as `woff`, `woff2`, `ttf`, `otf`, `eot`
  - static files such as `css`, `js`, `map`, `wasm`, `manifest`
  - known tracking opens such as SendGrid `/wf/open`
- Keep archive/download links such as `.zip` unless there is a stronger reason to filter them.
- For HTML, prefer visible anchor links. Do not treat image-only anchors as useful structured links.

## Local Viewer

- The viewer under `viewer/` is local-only for now; do not deploy it to the server unless requested.
- The viewer should prioritize speed and newest mail first.
- Layout expectation:
  - left column: mailbox list with `All`
  - middle column: selected mailbox messages
  - right column: selected message detail
  - top controls: sender, keyword, latest count, auto-refresh
- Auto-refresh should default on with a 5-second polling interval.
- Mailbox names, emails, verification codes, and structured links should be easy to copy.
- Toasts should be visible in the top-right.
- API base can be displayed read-only; API key should not be shown in the UI.

## Deployment Notes

- Server host alias used so far: `tengxun-tokyo-01`.
- Server deployment directory used so far: `/home/ubuntu/automail-deploy`.
- App container name used so far: `simple-mail-service`.
- Server API binding used so far: app HTTP on `127.0.0.1:3001`, Caddy public HTTPS on `mail.berich.xyz`.
- When deploying code, sync without `.git/`, `node_modules/`, `data/`, or `.env`, then rebuild only the app service unless database changes require otherwise.

## Testing

- Run `npm test` before committing backend or shared logic changes.
- Run `node --check viewer/app.js` for viewer JavaScript changes.
- Current unit tests cover config, HTTP routing, storage, structured extraction, and backfill argument parsing.
- Frontend viewer does not currently have browser-level tests; add Playwright or jsdom-based tests if viewer logic becomes more complex.
