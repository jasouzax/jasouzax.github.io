# Runtime-only correction on an already tested image with unchanged website sources, assets and dependencies.
# Full releases use the root Dockerfile. This recipe deliberately replaces only the wrapper and registry source.
ARG JAZU_BASE_IMAGE=registry.jasouza.com/jazu@sha256:eb0fd47551008fd99e04f7cb09e13cafeff9feae073ae8e00459e48ffc7c7984
FROM ${JAZU_BASE_IMAGE}
ARG JAZU_REVISION=unknown
LABEL org.opencontainers.image.revision=$JAZU_REVISION
COPY ops/docker/entry.ts ops/docker/health.ts ops/docker/compose.yaml /opt/jazu/ops/docker/
COPY src/node/registry.ts /opt/jazu/src/node/registry.ts

HEALTHCHECK --interval=30s --timeout=30s --start-period=300s --retries=3 CMD ["node", "ops/docker/health.ts"]
