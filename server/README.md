# Jazu server (the Pi agent)

The Electron app behind `jasouza.com/server`. It makes **outbound** connections only: it dials the Worker's `Server_Hub` Durable Object, and the page (once you are signed in as the owner) talks to the Pi through it. Not started means "server offline" on the site; nothing else in Jazu depends on it. Design and limits: [`docs/feat/server.md`](../docs/feat/server.md).

It replaces the standalone Browsite prototype: scripts (`*.auto.js`), windows with a live feed, APIs and the selector helper live here now.

## Run

```bash
cd server
npm install
cp .env.example .env      # set SERVER_AGENT_SECRET (same value as the Worker secret)
npm start                 # build + run (needs a display)
npm run start:headless    # build + run on a headless Pi through xvfb
npm test                  # unit tests (no Electron needed)
```

From the repository root, `npm run server` does the same as `npm start` here.

## Settings (`server/.env`)

| Name | Meaning |
| --- | --- |
| `JAZU_ORIGIN` | The Worker, `https://jasouza.com` by default (`http://127.0.0.1:8787` is allowed for a local `wrangler dev`) |
| `SERVER_AGENT_SECRET` | At least 32 characters; must equal the Worker secret `SERVER_AGENT_SECRET` (`openssl rand -hex 32`) |
| `SERVER_ROOT` | The page can only reach files below this folder (default `/`) |
| `FASTFETCH_STRUCTURE` | Colon separated fastfetch modules of the public snapshot; the default leaves out user, host name, IP and locale |

## Folders

| Path | What it is |
| --- | --- |
| `src/shared/` | The wire contract (`protocol.ts`) and byte helpers, imported by the Worker and the page as well |
| `src/web.ts`, `src/selector.ts` | The scriptable browser window (`Web`) and the resilient selector builder, see [`SELECTOR.md`](SELECTOR.md) |
| `src/server/` | Audio capture and clipboard bridge for the live feed |
| `assets/` | Hidden window used to capture a page's sound |
| `test/` | `node:test` suites, run with `npm test` |
