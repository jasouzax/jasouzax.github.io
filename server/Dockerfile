# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /repo/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/test ./test
COPY src/node/security.ts /repo/src/node/security.ts
RUN npm test && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 git openssh-client procps \
    xvfb xauth dbus libgtk-3-0 libnss3 libasound2 libgbm1 \
    libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /repo/server/package.json ./
COPY --from=build --chown=node:node /repo/server/node_modules ./node_modules
RUN node node_modules/electron/install.js && rm -rf /root/.cache/electron
COPY --from=build --chown=node:node /repo/server/dist ./dist
COPY --chown=node:node server/assets ./assets
COPY --chown=node:node server/test/interaction.smoke.cjs ./test/interaction.smoke.cjs
RUN mkdir user_data && chown node:node user_data
USER node
ENV NODE_ENV=production JAZU_VIRTUAL_DISPLAY=1
CMD ["dbus-run-session", "--", "xvfb-run", "-a", "-s", "-screen 0 1440x900x24 -nolisten tcp", "./node_modules/.bin/electron", ".", "--no-sandbox", "--disable-gpu"]
