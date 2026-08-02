FROM node:22-alpine AS base
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build
RUN node -e "require('pdfkit')"

# --- Production deps only ---
FROM base AS prod-deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true

# --- Runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY templates ./templates

# Migrations run on boot; see the script for why it fails hard rather than
# starting against a schema it does not match. Set RUN_MIGRATIONS_ON_BOOT=false
# to opt out (e.g. a one-off container that must not touch the schema).
COPY docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "node_modules/concurrently/dist/bin/concurrently.js", "-k", "-n", "api,worker", "node", "dist/src/main.js", "node", "dist/src/worker.js"]
