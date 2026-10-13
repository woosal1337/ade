FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --omit=dev --ignore-scripts --no-audit --no-fund

COPY src src
COPY server/src server/src

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health > /dev/null || exit 1
CMD ["node", "server/src/main.ts"]
