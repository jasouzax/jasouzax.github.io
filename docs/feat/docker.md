# Docker distribution and recovery

- [x] Container entry selects prebuilt website, custom content or persistent personal-server mode; static assets stream with byte ranges (runtime contract tests).
- [ ] Publish and pull native ARM64 and AMD64 images through `registry.jasouza.com`.
- [ ] Verify custom content and both image architectures on the Raspberry Pi.
- [ ] Move the Pi listener to Docker, preserving the old checkout/service and documenting rollback.
- [ ] Verify Git/CI after cutover and a container restart.

The image includes prepared WASM packages and a prebuilt default website. Compilation belongs to release builds, never an ordinary default startup. Building the image requires the release `build/` artifacts and public media archive; a missing WASM input fails the build. Runtime credentials and repositories are excluded from the image context.

`ops/docker/entry.ts` uses `/data` for generated custom sites and personal-server state. Default website mode serves the bundled `dist/`, including large assets without R2. `--content=/content` copies a read-only host mount into a writable workspace before building. `--personal-server` loads its live engine checkout from persistent storage so accepted code changes still survive process/container restarts. `--no-runner` is a transport-only migration smoke-test mode, not the normal service.

Image filesystem layers are bounded to keep individual registry transfers below the public proxy upload limit. Images support `linux/arm64` and `linux/amd64`; each architecture gets its own native Node dependencies. Persistent data is backed up separately from images; a volume on a broken SD card cannot restore itself.

The public registry is pull-only. `terraform/registry/` provisions its own R2 bucket, Worker and custom domain; it does not load the website's Terraform state. Set `TERRAFORM_BIN` if Terraform is outside PATH, then run `npm run tf:registry -- plan` and `npm run tf:registry -- apply`. Existing `.env` account, zone and API-token credentials are used only by the operator.

For releases, build into a loopback-only Distribution registry and publish its storage with `node --env-file=.env ops/docker/publish_registry.ts /path/to/registry-storage`. The publisher uploads verified immutable blobs before switching repository/tag indexes. Anonymous clients cannot upload, overwrite or delete images. Keep the registry bucket and Terraform state backed up; both are separate from the Pi's persistent runtime data.

Quick start (the image name is a registry reference, not a Git URL):

```sh
docker run --rm --init -p 8080:8080 registry.jasouza.com/jazu:latest
docker run --rm --init -p 8080:8080 --mount type=bind,src="$HOME/custom_content",dst=/content,readonly -v jazu-custom:/data registry.jasouza.com/jazu:latest --content=/content
docker run -d --name jazu-personal --init --restart unless-stopped -p 127.0.0.1:8788:8788 --env-file "$HOME/jazu-docker/runtime.env" -v "$HOME/jazu-docker:/data" registry.jasouza.com/jazu:latest --personal-server
```

Custom content must supply the themes/resources referenced by its configuration; add a read-only `/config.json` mount and `--config=/config.json` for an independent configuration. Image runs as UID 1000; bind-mounted data must be writable by that user. `ops/docker/compose.yaml` provides `website` and `personal` profiles. Set `JAZU_DATA_DIRECTORY` and `JAZU_ENV_FILE` to absolute host paths before using the personal profile.

Fresh personal-server bootstrap creates `/data/server.json` and an origin secret, clones the engine's configured upstream, and prepares the engine's WASM/media inputs from the image. Configure collaborators, project remotes, Cloudflare credentials, Tunnel and matching Worker HMAC before accepting authenticated pushes. Docker does not recreate credentials or Tunnel infrastructure. Restore `/data` and the external environment/SSH keys after hardware loss. Keep these private backups separate from public image storage. Multiple website instances are independent; run exactly one active personal-server CI controller for a data directory.

Migration: stop new submissions and wait for current CI; snapshot the original config, bare repositories and state into a **different** data directory, rewrite all configured paths to `/data/...`, and copy the engine Git checkout and its private Git credentials. Smoke-test a transport-only instance with `--no-runner` at a spare loopback port. Stop/disable `jazu-node` only after that passes, refresh the snapshot, then start the full Docker service at port 8788. Leave Cloudflared and `~/jasouzax.github.io` intact. Roll back with `docker stop jazu-personal` and `sudo systemctl enable --now jazu-node`. Never run the old and new CI controllers together.

Logs and recovery: `docker logs -f jazu-personal`; `docker inspect --format '{{.State.Health.Status}}' jazu-personal`; durable job logs are in `/data/state/runs`. Back up the whole data directory while its controller is stopped, plus the private environment file and Tunnel credentials. Save an offline image with `docker image save registry.jasouza.com/jazu:latest | gzip > jazu-image.tar.gz`; restore with `gunzip -c jazu-image.tar.gz | docker load`. Static website replicas can be deployed behind any load balancer or Kubernetes Service using this same image and port 8080.
