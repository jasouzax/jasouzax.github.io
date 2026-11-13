# Docker distribution and recovery

- [x] Container entry selects prebuilt website, custom content or persistent personal-server mode; static assets stream with byte ranges (runtime contract tests).
- [x] Publish and pull native ARM64 and AMD64 images through `registry.jasouza.com`.
- [x] Verify custom content and both image architectures on the Raspberry Pi.
- [x] Move the Pi listener to Docker, preserving the old checkout/service and documenting rollback.
- [x] Verify Git/CI after cutover and a container restart.

The image includes prepared WASM packages and a prebuilt default website. Compilation belongs to release builds, never an ordinary default startup. Building the image requires the release `build/` artifacts and public media archive; a missing WASM input fails the build. Runtime credentials and repositories are excluded from the image context.

`ops/docker/entry.ts` uses `/data` for generated custom sites and personal-server state. Default website mode serves the bundled `dist/`, including large assets without R2. `--content=/content` copies a read-only host mount into a writable workspace before building. `--personal-server` loads its live engine checkout from persistent storage so accepted code changes still survive process/container restarts. `--no-runner` is a transport-only migration smoke-test mode, not the normal service.

Image filesystem layers are bounded to keep individual registry transfers below the public proxy upload limit. Images support `linux/arm64` and `linux/amd64`; each architecture gets its own native Node dependencies. Persistent data is backed up separately from images; a volume on a broken SD card cannot restore itself.

The public registry is pull-only. `terraform/registry/` provisions its own R2 bucket, Worker and custom domain; it does not load the website's Terraform state. Set `TERRAFORM_BIN` if Terraform is outside PATH, then run `npm run tf:registry -- plan` and `npm run tf:registry -- apply`. Existing `.env` account, zone and API-token credentials are used only by the operator.

For releases, build into a loopback-only Distribution registry and publish its storage with `node --env-file=.env ops/docker/publish_registry.ts /path/to/registry-storage`. The publisher uploads verified immutable blobs before switching repository/tag indexes. Anonymous clients cannot upload, overwrite or delete images. Keep the registry bucket and Terraform state backed up; both are separate from the Pi's persistent runtime data.

Quick start (the image name is a registry reference, not a Git URL):

```sh
docker run --rm --init -p 8080:8080 registry.jasouza.com/jazu:latest
docker run --rm --init -p 8080:8080 --mount type=bind,src="$HOME/custom_content",dst=/content,readonly -v jazu-custom:/data registry.jasouza.com/jazu:latest --content=/content
mkdir -p "$HOME/jazu-docker/home"
docker run -d --name jazu-personal --init --restart unless-stopped -p 127.0.0.1:8788:8788 --env-file "$HOME/jazu-docker/runtime.env" -v "$HOME/jazu-docker:/data" -v "$HOME/jazu-docker/home:/home/node" registry.jasouza.com/jazu:latest --personal-server
```

Custom content must supply the themes/resources referenced by its configuration; add a read-only `/config.json` mount and `--config=/config.json` for an independent configuration. Image runs as UID 1000; bind-mounted data must be writable by that user. `ops/docker/compose.yaml` provides `website` and `personal` profiles. Set `JAZU_DATA_DIRECTORY` and `JAZU_ENV_FILE` to absolute host paths before using the personal profile.

Fresh personal-server bootstrap creates `/data/server.json` and an origin secret, clones the engine's configured upstream, and prepares the engine's WASM/media inputs from the image. Configure collaborators, project remotes, Cloudflare credentials, Tunnel and matching Worker HMAC before accepting authenticated pushes. Docker does not recreate credentials or Tunnel infrastructure. Restore `/data` and the external environment/SSH keys after hardware loss. Keep these private backups separate from public image storage. Multiple website instances are independent; run exactly one active personal-server CI controller for a data directory.

Migration: stop new submissions and wait for current CI; snapshot the original config, bare repositories and state into a **different** data directory, rewrite all configured paths to `/data/...`, and copy the engine Git checkout and its private Git credentials. Smoke-test a transport-only instance with `--no-runner` at a spare loopback port. Stop/disable `jazu-node` only after that passes, refresh the snapshot, then start the full Docker service at port 8788. Leave Cloudflared and `~/jasouzax.github.io` intact. Roll back with `docker stop jazu-personal` and `sudo systemctl enable --now jazu-node`. Never run the old and new CI controllers together.

Logs and recovery: `docker logs -f jazu-personal`; `docker inspect --format '{{.State.Health.Status}}' jazu-personal`; durable job logs are in `/data/state/runs`. Back up the whole data directory while its controller is stopped, plus the private environment file and Tunnel credentials. Save an offline image with `docker image save registry.jasouza.com/jazu:latest | gzip > jazu-image.tar.gz`; restore with `gunzip -c jazu-image.tar.gz | docker load`. Static website replicas can be deployed behind any load balancer or Kubernetes Service using this same image and port 8080.

Release from a Linux checkout containing the WASM/media inputs: `sh ops/docker/release.sh <tag>`. Docker Buildx must support both target architectures (on ARM, register an AMD64 emulator once with `docker run --privileged --rm tonistiigi/binfmt --install amd64`, or use native build nodes). The private staging registry binds only `127.0.0.1:5000`; public writes remain disabled. Publish a candidate tag, test public pulls and both runtime modes, then release `latest`. Pin production services to a tested tag or digest when reproducible rollback is required. To release an identical tested manifest under `latest`, copy its manifest in the local Distribution registry and rerun the publisher; rebuilding is unnecessary.

Registry infrastructure also creates a configuration rule disabling Browser Integrity Check only for GET/HEAD on this registry's `/v2` API. Machine clients must not require a browser challenge. If a zone already owns an `http_config_settings` entrypoint, import and preserve its existing rules before applying this standalone module. The current setup has no competing entrypoint. [Cloudflare documents this API-specific configuration](https://developers.cloudflare.com/rules/configuration-rules/settings/#browser-integrity-check).


The personal service also mounts its persistent `home/` at the image user's login home, `/home/node`. Git reads `/data/home/.gitconfig`, while OpenSSH resolves keys and known hosts through the login home; both paths must reference the same persistent files. Create the host `home/` directory as UID 1000 before starting a bind-mounted service. This is included in the Compose profile and personal-server command above.


Pi release verification (2026-11-13): candidate `docker-52e579c`, multi-platform index `sha256:eb0fd47551008fd99e04f7cb09e13cafeff9feae073ae8e00459e48ffc7c7984`, pulled anonymously through the public registry. ARM64 and emulated AMD64 both served the website and passed health checks. An independent read-only custom-content/config fixture built and served; restarting removed a deleted content file. Signed transport health, master/staging Git advertisements and GitHub SSH access passed before cutover. An 86,109,341-byte public registry blob passed a complete SHA-256 check; full-object reads return 200 and explicit byte ranges return 206. The 56 server regression tests and Docker/registry contracts passed locally.

For a startup-only correction on a constrained builder, `ops/docker/runtime.Dockerfile` reuses a tested image and replaces only the startup/health wrapper, Compose example, registry source and the `python` compatibility command. Use this only when website sources, content, WASM inputs and dependencies are unchanged from that base; use the root Dockerfile for all other releases. The corrected AMD64 prototype uses this path because the Pi must also retain its original native installation. Both recipes produce the same runtime interfaces and are tested through public pulls.


Final Docker runtime and current `latest`: `registry.jasouza.com/jazu:docker-cd8323c`, index `sha256:4d4536e62b3ca8e7e1158d3419be8415ec8d5787e66f261c34c7504adb07b8b1`. Both architectures were pulled publicly. ARM64 cold bootstrap restored all 135 compiled inputs and completed a full website build; AMD64 served the website and built independent custom content under emulation. Health checks allow 30 seconds for slower CPUs/emulators. Restoration materializes image links into writable files, repairs legacy links pointing into the image, and preserves existing project files; custom content rejects links leaving its mounted directory.

The Pi now runs container `jazu-personal` at loopback port 8788 using `~/jazu-docker`; `jazu-node` is disabled and the original `~/jasouzax.github.io`, repositories and state remain available. An authenticated push through the staging Worker reached Docker, synchronized to GitHub, built and deployed Pages/R2 successfully (`fe36924`); Docker restarts retained the repositories and credentials. Logs: `docker logs -f jazu-personal`, detailed runs at `~/jazu-docker/state/runs/`. The original service is a cutover fallback; retain the current Docker data before rolling back after accepting newer pushes.

The finalized Docker branch was merged with `--no-ff` as `3d818b3` (`merge: branch 'feature/docker'`). A production CI run found that an independent ZIP-reader test invokes `python`, so `cd8323c` adds the compatibility entry point to Python 3 in both image recipes. Both ARM64 and AMD64 executed it successfully. All 185 production tests then passed, followed by build and Pages/R2 deployment. A fresh default-master container bootstrapped successfully; the final image serves website health with HTTP 200 and the Pi's final personal-server container passes signed health. `latest` resolves to the digest above through the public registry. The temporary push-test collaborator was revoked and its credential subsequently returned HTTP 401.

The running container is pinned to `docker-cd8323c`. A stopped `jazu-personal-previous` container is retained as an additional image rollback point; it shares the same persistent data and must stay stopped while the new controller runs. Preserve a data snapshot before any rollback. The original native service and checkout remain untouched apart from disabling the service.
