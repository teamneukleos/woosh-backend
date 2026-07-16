# Build stage
FROM node:24-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:24-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# prisma CLI is a devDependency but needed for generate + schema sync at startup
RUN npm ci --omit=dev \
  && npm install prisma@6.7.0 --no-save \
  && npx prisma generate \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh \
  && sed -i 's/\r$//' ./docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "dist/main.js"]
