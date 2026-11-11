FROM node:22-bookworm-slim AS frontend
WORKDIR /build
RUN npm install --global pnpm@10.11.1
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN mkdir -p .cache/empty && echo '{"name":"empty-override"}' > .cache/empty/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
COPY . .
ENV FORK_DEPLOY=true VUE_APP_PUBLIC_PATH=/
RUN pnpm exec vue-tsc --noEmit && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --chown=node:node server ./
COPY --from=frontend --chown=node:node /build/dist ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
USER node
EXPOSE 8080
CMD ["node", "index.mjs"]
