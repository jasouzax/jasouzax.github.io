# Docker distribution and recovery

- [x] Container entry selects prebuilt website, custom content or persistent personal-server mode; static assets stream with byte ranges (runtime contract tests).
- [ ] Publish and pull native ARM64 and AMD64 images through `registry.jasouza.com`.
- [ ] Verify custom content and both image architectures on the Raspberry Pi.
- [ ] Move the Pi listener to Docker, preserving the old checkout/service and documenting rollback.
- [ ] Verify Git/CI after cutover and a container restart.

The image includes prepared WASM packages and a prebuilt default website. Compilation belongs to release builds, never an ordinary default startup. Building the image requires the release `build/` artifacts and public media archive; a missing WASM input fails the build. Runtime credentials and repositories are excluded from the image context.

`ops/docker/entry.ts` uses `/data` for generated custom sites and personal-server state. Default website mode serves the bundled `dist/`, including large assets without R2. `--content=/content` copies a read-only host mount into a writable workspace before building. `--personal-server` loads its live engine checkout from persistent storage so accepted code changes still survive process/container restarts. `--no-runner` is a transport-only migration smoke-test mode, not the normal service.

Image filesystem layers are bounded to keep individual registry transfers below the public proxy upload limit. Images support `linux/arm64` and `linux/amd64`; each architecture gets its own native Node dependencies. Persistent data is backed up separately from images; a volume on a broken SD card cannot restore itself.
