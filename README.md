# Woosh API

NestJS + Prisma 6.7 + PostgreSQL. Built separately from the Next.js app in `../woosh` — do not point that UI at this API until identity and later slices are ready.

## Setup

Use any Postgres instance via `DATABASE_URL`. Docker Compose is optional.

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run prisma:seed   # optional demo users (password password123)
npm run start:dev
```

API: `http://localhost:4000/api`  
Swagger (try endpoints here): **http://localhost:4000/api/docs**

Click **Authorize**, paste the access token from `/auth/login`, then call `/auth/me`.

## Identity (current slice)

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | no |
| POST | `/api/auth/register` | no |
| POST | `/api/auth/login` | no |
| POST | `/api/auth/refresh` | no |
| POST | `/api/auth/logout` | no |
| POST | `/api/auth/verify-email` | no |
| POST | `/api/auth/resend-verification` | no |
| POST | `/api/auth/forgot-password` | no |
| POST | `/api/auth/reset-password` | no |
| GET | `/api/auth/me` | Bearer access token |

Register body: `{ "name", "email", "password", "accountType": "creator"|"brand"|"agency" }`

Verification and reset links are logged to the Nest console until email is wired. Login requires `ACTIVE` + verified email.

## Prisma

Schema is split by domain under `prisma/`.

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run prisma:studio
```
