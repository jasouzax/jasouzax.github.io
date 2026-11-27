# Update the live installation

Run from the repository root on your Windows development machine. The actual update code is in [update-cloud.mjs](../ops/update-cloud.mjs) and [update-server.py](../ops/update-server.py). Neither contains credentials.

Prerequisites: Node 24+, `npm ci`, prepared ignored `build/` WASM files and `content/media/`, Python with `paramiko` (`py -m pip install paramiko`), and the existing private `.env` containing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (or `TF_VAR_account_id`). Preserve the original secrets. SSH known_hosts must contain the personal server's verified host key. SSH keys work; otherwise the updater prompts for the password without echoing or saving it.

```powershell
git fetch origin
git switch staging
git pull --ff-only origin staging
npm ci
node --env-file=.env ops/update-cloud.mjs staging

git switch master
git pull --ff-only origin master
node --env-file=.env ops/update-cloud.mjs production
python ops/update-server.py --host 192.168.1.22 --user jason
```

Merge/push application revisions first. HEAD must match the corresponding GitHub branch; the server uses master. Check staging before production. Rerun `npm ci` after switching branches if package-lock differs. These scripts update existing hosting/services; they do not provision a new installation.

The cloud updater builds with the correct domain, saves previous Worker settings/code under `.cache/live-update/`, uploads the Worker while inheriting every existing binding, verifies binding identities, then publishes Pages/R2 with the Git commit. It checks the canonical Pages deployment revision. It does not replace secrets, change DNS, or replay Durable Object migrations. If a future revision adds SQL migrations or bindings, apply those using the existing infrastructure workflow first.

The server updater compiles the Electron agent locally, compares prepared build inputs by SHA-256, and uploads tracked source, compiled JavaScript and changed WASM/build inputs. It prepares service images through temporary containers over the current images, installs dependency changes, and runs isolated restart/PTY checks. This avoids unpacking another full Docker build tree on the small SD card. Existing OS packages, Electron and media inputs are reused; use the full Dockerfiles when OS/Electron inputs change. It fast-forwards `/home/jason/jazu-docker/work/jazu`, updates its ignored build inputs, restarts the personal listener, then replaces staging and production agents. It preserves inspected environment, volumes, ports, restart policy, UID, network, shared memory and devices, including production I2C. At least 512 MiB free space is required.

Previous containers remain stopped as `<service>-before-<commit-prefix>-<timestamp>` (the initial deployment also retained backups without the timestamp suffix). Private configuration snapshots and operation records remain under `/home/jason/deploy-updates/<commit-prefix>-<timestamp>/`, mode 0700. **Do not publish those snapshots:** Docker configuration includes secret environment values. The updater checks personal-service health, restart counts and mount identities. Check agent connectivity afterward through both sites' `/api/_/server` endpoints.

If one replacement fails, that service is restored from its saved container and the updater stops. Earlier successful replacements remain in place. A manual agent rollback consists of stopping the new agent, renaming it aside, restoring the recorded backup container's original name and starting it. Preserve data volumes. A personal-listener rollback also requires restoring its recorded checkout revision while stopped.

```powershell
curl.exe https://jasouza.com/api/_/health
curl.exe https://staging.jasouza.com/api/_/health
curl.exe https://jasouza.com/api/_/server
curl.exe https://staging.jasouza.com/api/_/server
ssh jason@192.168.1.22 'docker ps'
```

A running public automation script named `test` should answer at `/api/test`. An unpublished API name returns 404 rather than the old 501. Google/Drive account consent still uses the normal interactive authorization flow.
