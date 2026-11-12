# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS operating_system
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client python3 ca-certificates && rm -rf /var/lib/apt/lists/*

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS website_build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY config.json tsconfig.json .gitignore ./
COPY src/ ./src/
COPY content/ ./content/
COPY build/ ./build/
# WASM packages are compiled release inputs from build/. A missing input fails the website build.
RUN npm run build && rm -rf node_modules .cache

FROM operating_system AS payload
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=website_build /app/ ./
COPY ops/docker/ ./ops/docker/
RUN node ops/docker/layers.ts /app /layers

FROM operating_system AS runtime
ARG JAZU_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/jasouzax/jasouzax.github.io" org.opencontainers.image.revision=$JAZU_REVISION
WORKDIR /opt/jazu
COPY --from=payload /layers/00/ ./
COPY --from=payload /layers/01/ ./
COPY --from=payload /layers/02/ ./
COPY --from=payload /layers/03/ ./
COPY --from=payload /layers/04/ ./
COPY --from=payload /layers/05/ ./
COPY --from=payload /layers/06/ ./
COPY --from=payload /layers/07/ ./
COPY --from=payload /layers/08/ ./
COPY --from=payload /layers/09/ ./
COPY --from=payload /layers/10/ ./
COPY --from=payload /layers/11/ ./
COPY --from=payload /layers/12/ ./
COPY --from=payload /layers/13/ ./
COPY --from=payload /layers/14/ ./
COPY --from=payload /layers/15/ ./
COPY --from=payload /layers/16/ ./
COPY --from=payload /layers/17/ ./
COPY --from=payload /layers/18/ ./
COPY --from=payload /layers/19/ ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production
EXPOSE 8080 8788
VOLUME /data
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 CMD ["node", "ops/docker/health.ts"]
ENTRYPOINT ["node", "ops/docker/entry.ts"]
