# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /repo/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY server/tsconfig.json ./
COPY server/browser ./browser
COPY server/link ./link
COPY server/terminal ./terminal
COPY server/api ./api
COPY server/config ./config
COPY server/test ./test
COPY shared /repo/shared
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
COPY --chown=node:node server/test/interaction.smoke.cjs server/test/restart.smoke.cjs server/test/terminal.smoke.cjs ./test/
RUN mkdir user_data && chown node:node user_data
# Keep UID/GID 1000 so existing persistent data stays writable.
RUN groupmod -n jason node \
    && usermod --login jason --home /home/jason --move-home node \
    && ln -s /home/jason /home/node
USER jason
ENV HOME=/home/jason USER=jason LOGNAME=jason NODE_ENV=production JAZU_VIRTUAL_DISPLAY=1
CMD ["dbus-run-session", "--", "xvfb-run", "-a", "-s", "-screen 0 1440x900x24 -nolisten tcp", "./node_modules/.bin/electron", ".", "--no-sandbox", "--disable-gpu"]
