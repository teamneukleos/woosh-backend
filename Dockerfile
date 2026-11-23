# Woosh API (NestJS + Prisma) — production image for ECS Fargate.
# Build: docker build -t woosh-api .

FROM node:20-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which needs the schema.
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
# Dev dependencies stay in: the Prisma CLI runs `migrate deploy` at startup.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node docker-entrypoint.sh ./
USER node
EXPOSE 4000
# CMD (not ENTRYPOINT) so scheduled job tasks can replace it with a one-off command.
CMD ["./docker-entrypoint.sh"]
