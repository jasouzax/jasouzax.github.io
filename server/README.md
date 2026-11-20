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
npm run test:interaction  # Linux/Xvfb: real Electron iframe input + DevTools regression (build first)
```

From the repository root, `npm run server` does the same as `npm start` here.

## Docker (headless Linux, including ARM64)

The container runs Electron as the unprivileged `jason` user (UID/GID 1000) with Xvfb. It only
connects outbound; no ports, host display, privileged mode or Docker socket are
needed. Chromium uses `--no-sandbox` inside this container, as in the existing
headless command. Files and shells belong to the container's user and filesystem.
`JAZU_VIRTUAL_DISPLAY=1` keeps browser windows inside Xvfb's visible area so the
live feed produces frames; ordinary desktop runs still hide and park windows.

From `server/`:

```bash
mkdir -p home workspace user_data
# Bind mounts must be writable by UID/GID 1000.
sudo chown 1000:1000 home workspace user_data
cp .env.example .env
# Set JAZU_ORIGIN=https://staging.jasouza.com and the staging Worker's secret.
chmod 600 .env
docker compose up -d --build
docker compose logs --tail=50 agent
```

The build context is the repository root because the signing tests use the
Worker's verifier. The image runs the agent tests and TypeScript build before
packaging. Electron is a runtime dependency and its binary is explicitly installed.

The remote file manager shows the container's `/`; `/workspace` holds persistent
files. Terminal commands run inside the container. The page currently opens `/`,
so Compose uses `SERVER_ROOT=/`. The default shell home is `/home/jason`, persisted
in the `home` bind mount; `/home/node` is a compatibility symlink for older scripts.
Browser sessions and automation restart state persist in `user_data`. All bind mount directories
must be writable by UID 1000. To use external storage, set
`JAZU_AGENT_HOME`, `JAZU_AGENT_WORKSPACE`, `JAZU_AGENT_USER_DATA`, and `JAZU_AGENT_ENV_FILE` before
running Compose. Keep the environment file outside source control.

### Staging Pi deployment (2026-11-20)

The deployment is under `/home/jason/jazu-server-staging` on `192.168.1.22`:
`app/server` contains this Compose project, `runtime.env` contains private agent
settings, and `home`, `workspace` and `user_data` contain persistent files. Manage it with:

```bash
cd /home/jason/jazu-server-staging/app/server
docker compose --env-file ../../compose.env up -d
docker compose --env-file ../../compose.env logs --tail=50 agent
docker compose --env-file ../../compose.env restart agent
```

The container is `jazu-server-staging` and restarts automatically. The existing
`jazu-personal` Git/publishing service is a separate Compose project.

### Migrating an existing container home

Before recreating an older agent, stop it and copy its home to the new host bind
mount. Run this as the deployment user, from `server/` (or use the configured
`JAZU_AGENT_HOME` path):

```bash
docker compose stop agent
mkdir -p home
docker cp jazu-server-staging:/home/node/. ./home/
sudo chown -R 1000:1000 home
docker compose up -d --build
```

The mount survives container recreation and image upgrades. Keep it with the
workspace and user_data backups. This is the container account's home; signing
into the website does not mount the host account's private home directory.

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

## Manual input into embedded frames

The streamed browser relays owner input with Chromium's `Input` domain so clicks,
keyboard input, scrolling and dragging reach cross-process frames as well as the
main page. Input is queued per browser target to keep presses and releases in
order. This is a remote-control transport; verification challenges remain manual.

To check a built image without connecting an agent or using external websites:

```bash
docker run --rm --init --network none --entrypoint npm jazu-server:staging run test:interaction
```

The regression serves local controls on distinct loopback origins, checks trusted
checkbox/button events, keyboard/text, drag and scroll, and verifies the DevTools
feed while the embedded page remains interactive.

## Automation restart behavior

Starting a `*.auto.js` script saves it in `user_data/autostart.json` before it
executes. On agent startup, saved scripts start again. This file shares the
persistent `user_data` Docker mount with browser profiles.

A normal completion, Stop, or Delete removes the script from the list. An uncaught
runtime, syntax, timer, or API-handler error closes that run's windows/APIs and
restarts from its saved source. An unreadable source also retries. Retry delays
increase from 1 second to a maximum of 60 seconds; a run lasting at least a minute
resets that delay. Sessions and the log view show Restarting and offer Stop while
waiting. Agent shutdown preserves the list, including scripts waiting to retry.
Scripts resume from the beginning; their JavaScript memory is not restored.
