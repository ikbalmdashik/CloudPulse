# CloudPulse

[![CI](https://github.com/ikbalmdashik/CloudPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/ikbalmdashik/CloudPulse/actions/workflows/ci.yml)

A real-time service request management system for IT infrastructure and cloud operations. Operators submit requests (new VMs, health checks, configuration changes, audits, access resets). Supervisors approve them. A pool of background workers processes several at once, and everyone watches progress update live over WebSockets.

| Document | Contents |
|---|---|
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | Problem statement, objectives, users, assumptions, scope, functional and non-functional requirements |
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture and component diagrams, ERD, API design, WebSocket flow, concurrency model, security, stack justification |
| This README | Setup, build and run, configuration, API reference, WebSocket events, database setup |

## Features

- **Request lifecycle.** Submit → approve or reject (four-eyes: never your own) → queued → processed step by step → completed, failed or cancelled. Failed requests can be retried.
- **Live everywhere.** Lists, detail pages, progress bars and the queue panel update the moment something changes, with notifications for the people involved. No polling.
- **Concurrent background processing.** A configurable number of worker slots (`CPU-1 … CPU-n`) run requests in parallel by priority, with automatic retries, exponential backoff and crash recovery.
- **Roles.**
  - **Operators** see their own requests.
  - **Supervisors** see everything and can approve, reject, prioritize, add notes, retry and approve in bulk.
  - **Admins** can also manage users' roles.
- **Search and filters.** Search by code or title; filter by status, category, priority and time submitted (last 1 minute up to 30 days). Filters live in the URL.
- **Bulk approval.** Approve every request in the current filtered view in one click, safely.
- **Accounts.** Sign up, log in with "Remember me", up to 5 accounts per browser with one-click switching.
- **Responsive UI** with light and dark themes, breadcrumbs and Back navigation.

## Architecture overview

```mermaid
flowchart LR
    B["Browser<br/>Next.js app"] -- "REST via /api/* (cookies)" --> N["Next.js :3000<br/>rewrite"] --> A
    B <-->|"WebSocket (Socket.IO)"| A["NestJS API :4000<br/>REST · gateway · worker pool"]
    A <--> D[("PostgreSQL<br/>data + job queue")]
```

- **Frontend** (`frontend/`): Next.js 16 / React 19. TanStack Query holds server state, and pushed WebSocket events are written into the same cache.
- **Backend** (`backend/`): NestJS 12, organized in layers (controller → service → repository) per module: `auth`, `users`, `requests`, `worker`, `realtime`.
- **Writes go through REST** and are validated and authorized there; the **WebSocket only pushes** the results to the right rooms (`staff`, `user:<id>`).
- **Workers** run as asynchronous tasks inside the API process and claim jobs from PostgreSQL with compare-and-set plus leases, so long jobs never block the API and no request is processed twice.

Full diagrams and reasoning are in [docs/DESIGN.md](docs/DESIGN.md).

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 16, React 19 (React Compiler), TypeScript, TanStack Query 5, react-hook-form + zod, Tailwind CSS, shadcn/ui on Base UI, Socket.IO client, sonner, next-themes |
| Backend | Node.js, NestJS 12, TypeScript, Socket.IO (`@nestjs/websockets`), `@nestjs/jwt`, `@nestjs/config`, zod 4 |
| Database | PostgreSQL 18, Prisma ORM (Postgres) with versioned migrations |
| Tooling | Vitest, oxlint, ESLint, Prettier, Docker + Docker Compose, GitHub Actions |

Why each was chosen: [docs/DESIGN.md §8](docs/DESIGN.md#8-technology-stack-and-justification).

## Project structure

```
CloudPulse/
├── docker-compose.yml        # The whole stack in Docker
├── .env.example              # Settings for the Docker stack
├── .github/workflows/ci.yml  # CI: lint, typecheck, test, build, Docker images
├── docs/                     # Analysis and design documents
├── backend/                  # NestJS API, WebSocket gateway, worker pool
│   ├── Dockerfile
│   ├── docker-compose.yml    # PostgreSQL only, for local development
│   ├── migrations/           # Versioned database migrations
│   └── src/
│       ├── auth/             # Login, sessions, guards, cookies
│       ├── users/            # Sign-up, user admin, password hashing
│       ├── requests/         # Request API, lifecycle rules, repository
│       ├── worker/           # Background worker pool, job queue, /queue/stats
│       ├── realtime/         # Socket.IO gateway and event emitter
│       ├── config/           # Environment validation
│       ├── common/           # Global error filter
│       ├── prisma/           # Schema contract and DB client
│       └── scripts/          # seed-admin
└── frontend/                 # Next.js web app
    ├── Dockerfile
    └── src/
        ├── app/              # Routes: (auth) login/register, (app) dashboard, requests, admin
        ├── components/       # App shell, requests, admin, auth, ui primitives
        ├── hooks/            # Data hooks (TanStack Query)
        └── lib/              # API client, realtime client, validation, labels, types
```

## Quick start with Docker

Runs the whole stack (PostgreSQL, migrations, the API with its workers, and the web app) with one command. You need only Docker.

```bash
cp .env.example .env
```

In `.env`, set `JWT_SECRET` (at least 32 random characters) and `ADMIN_PASSWORD` (at least 8 characters, with a letter and a number). Then:

```bash
docker compose up --build
```

Open http://localhost:3000 and log in as `ADMIN_EMAIL`.

- **What starts:**
  - `postgres`
  - `migrate`: applies migrations, creates the admin if it doesn't exist, then exits
  - `backend` on port 4000
  - `frontend` on port 3000
- **Ports in use?** Set `FRONTEND_PORT` and `BACKEND_PORT` in `.env`.
- **Stop:** `docker compose down`. Add `-v` to also delete the database.

The images are multi-stage builds that run as a non-root user. The frontend uses Next.js standalone output, and the backend has a healthcheck that the frontend waits for.

## Development setup

Use this to work on the code with hot reload: the database runs in Docker, and both apps run with npm.

### Prerequisites

- Node.js 24+ and npm
- Docker (for PostgreSQL), or your own PostgreSQL 16+

### 1. Database setup

```bash
cd backend
```

```bash
docker compose up -d
```

This starts PostgreSQL 18 on `localhost:5432` with database `cloudpulse_db` (user `postgres`, password `postgres123`; for local use only).

### 2. Backend configuration

```bash
cp .env.example .env
```

Uncomment the lines in `.env` and set `JWT_SECRET` to a random string of at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app checks every setting at startup and stops with a clear message if one is missing or invalid. All settings are listed under [Configuration](#configuration).

### 3. Install, migrate and seed

```bash
npm install
```

```bash
npx prisma db migrate
```

```bash
npm run seed:admin
```

`db migrate` creates the tables from `migrations/`. `seed:admin` creates the first admin from `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` in `.env`. Everyone who signs up afterwards starts as an operator; promote them on the **Users** page.

### 4. Run the backend

```bash
npm run start:dev
```

The API and the WebSocket gateway listen on http://localhost:4000, and the worker pool starts with them.

### 5. Run the frontend

In a second terminal:

```bash
cd frontend
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 and log in as the seeded admin.

**Try it:** sign up a second account (an operator) in another browser or a private window and submit a request. Approve it as the admin and watch both windows update as the workers process it.

### Build and run for production

```bash
cd backend && npm run build && npm run start:prod
```

```bash
cd frontend && npm run build && npm start
```

Set `NODE_ENV=production` for the backend, so cookies become `Secure` (HTTPS only). Point the frontend at the API with `BACKEND_URL` (server-side rewrite target) and `NEXT_PUBLIC_REALTIME_URL` (browser WebSocket URL); both default to `http://localhost:4000`.

### Tests, linting and CI

```bash
cd backend && npm test
```

```bash
cd backend && npm run lint
```

```bash
cd frontend && npm run lint
```

[GitHub Actions](.github/workflows/ci.yml) runs on every push to `main` and on every pull request:

- **Backend:** lint, typecheck, tests and build
- **Frontend:** lint, typecheck and production build
- **Docker:** both images build

The backend has 104 unit tests covering auth, sessions and multi-account, users and roles, request lifecycle and four-eyes rules, bulk approval, worker claiming, retries and recovery, and env validation.

## Configuration

Backend environment variables (`backend/.env`, validated in [`src/config/env.ts`](backend/src/config/env.ts)):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production` or `test` |
| `PORT` | `4000` | HTTP and WebSocket port |
| `DATABASE_URL` | — (required) | `postgresql://…` connection string |
| `JWT_SECRET` | — (required) | At least 32 characters; signs access tokens |
| `ACCESS_TOKEN_TTL_MINUTES` | `10` | Access token lifetime (1–60) |
| `SESSION_TTL_HOURS` | `8` | Session length without "Remember me" |
| `REMEMBER_ME_DAYS` | `30` | Session length with "Remember me" |
| `WORKER_ENABLED` | `true` | Run the worker pool in this process |
| `WORKER_CONCURRENCY` | `4` | Requests processed at the same time (1–20) |
| `WORKER_POLL_MS` | `1000` | Fallback poll interval for idle workers (new work wakes them at once) |
| `WORKER_LEASE_SECONDS` | `30` | A job is retried if its worker stops renewing for this long |
| `WORKER_MAX_ATTEMPTS` | `3` | Attempts before a request is marked FAILED |
| `WORKER_STEP_MS` | `2000` | Average duration of one simulated step |
| `WORKER_FAILURE_RATE` | `0.03` | Chance a step fails, to demonstrate retries (0 disables) |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Origin allowed to open WebSocket connections |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | — | Used only by `npm run seed:admin` |

Frontend environment variables (optional): `BACKEND_URL` and `NEXT_PUBLIC_REALTIME_URL`, both defaulting to `http://localhost:4000`.

## API reference

Base URL: `http://localhost:4000` (from the browser: `http://localhost:3000/api`). Bodies are JSON.

**Authentication.** Browsers use the httpOnly cookies set by `POST /auth/login`; API clients send `Authorization: Bearer <accessToken>` from the login response. Routes marked *public* need neither.

**Errors** always have this shape:

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["title: must be 3-120 characters"], "path": "/requests", "timestamp": "2026-11-20T10:00:00.000Z" }
```

| Code | Meaning |
|---|---|
| 400 | Invalid input (`message` lists each field) |
| 401 | Not logged in, or the session expired |
| 403 | Your role doesn't allow it, or it's your own request (four-eyes) |
| 404 | Not found, or not visible to you |
| 409 | Conflict: changed since you loaded it (send the latest `version`), wrong state, or duplicate |

### Auth

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password, rememberMe? }` → `{ user, tokenType, accessToken, accessTokenExpiresAt, refreshToken, sessionExpiresAt, rememberMe }`; also sets cookies. 200 · 400 · 401 · 403 deactivated |
| POST | `/auth/refresh` | public | New access and refresh tokens for the active account (cookie), or `{ refreshToken }` for API clients. The old refresh token stops working. 200 · 401 |
| GET | `/auth/me` | user | The signed-in user `{ id, email, fullName, role }` |
| GET | `/auth/accounts` | public | Accounts saved in this browser, most recently used first; `active` marks the current one |
| POST | `/auth/switch` | public | `{ userId }`: switch to another saved account without a password. 200 · 401 session ended · 404 |
| POST | `/auth/logout` | public | Sign out of the active account. 204 |
| POST | `/auth/accounts/:userId/logout` | public | Sign one saved account out of this browser. 204 |
| POST | `/auth/logout-all` | public | Sign every saved account out. 204 |

### Users

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/users` | public | Sign up: `{ email, fullName, password }` → user (always OPERATOR). 201 · 400 · 409 email taken |
| GET | `/users?role=&search=&limit=&offset=` | admin | List users, newest first → `{ items, total, limit, offset }` |
| PATCH | `/users/:id/role` | admin | `{ role: "SUPERVISOR" }` promotes an operator; `{ role: "OPERATOR" }` demotes a supervisor. 200 · 404 · 409 |

### Requests

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/requests` | user | Submit. Body below. Optional `Idempotency-Key` header (8–100 chars) makes retries safe. 201 created · 200 same key retried · 409 key used by someone else |
| GET | `/requests` | user | List, newest first. Operators get their own; staff get all. Query below → `{ items, total, limit, offset }` |
| GET | `/requests/:id` | user | One request with `events` (timeline) and `jobs` (latest attempt). 404 if missing or not yours |
| PATCH | `/requests/:id` | staff | `{ version, priority?, note? }`: change priority and/or add a timeline note. 409 finished or stale |
| POST | `/requests/:id/approve` | staff | `{ version }`: AWAITING_APPROVAL → PENDING, queued for a worker. 403 own request · 409 |
| POST | `/requests/:id/reject` | staff | `{ version, reason }`: → REJECTED; the reason is shown to the submitter. 403 · 409 |
| POST | `/requests/approve-all` | staff | Bulk approve. Body below → `{ approved, skippedOwn, skippedChanged, remaining }` |
| POST | `/requests/:id/retry` | staff | `{ version }`: FAILED → PENDING with a fresh set of attempts. 409 |
| POST | `/requests/:id/cancel` | submitter or staff | `{ version, reason? }`: → CANCELLED; a running job stops at its next step. 409 finished |
| GET | `/queue/stats` | staff | `{ requests: {status: count}, jobs: {status: count}, workers: { enabled, concurrency, busy, slots[] } }` |

*Staff* means SUPERVISOR or ADMIN.

**Create body:**

```json
{
  "title": "Provision a VM for the billing service",
  "description": "4 vCPU, 16 GB RAM",
  "category": "VM_PROVISIONING",
  "priority": "HIGH",
  "payload": { "environment": "staging", "target": "billing-api-02" }
}
```

- `category`: `VM_PROVISIONING`, `HEALTH_DIAGNOSTIC`, `CONFIG_UPDATE`, `AUDIT_REPORT` or `ACCESS_RESET`
- `priority`: `LOW`, `MEDIUM` (default), `HIGH` or `CRITICAL`
- `environment`: `development`, `staging` or `production`
- Title is 3–120 characters; description at most 2000.

**List query parameters:**

| Parameter | Values |
|---|---|
| `status` | `AWAITING_APPROVAL`, `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED` or `REJECTED` |
| `active` | `true`: only AWAITING_APPROVAL, PENDING and IN_PROGRESS |
| `category`, `priority` | As in the create body |
| `search` | Case-insensitive match on code or title |
| `since` | Submitted within: `1m`, `5m`, `15m`, `30m`, `1h`, `6h`, `24h`, `7d` or `30d` |
| `asOf` | ISO date-time the window is measured back from (default: now) |
| `limit`, `offset` | Page size 1–100 (default 20), offset ≥ 0 |

**Bulk approval body:** `{ since?, category?, priority?, search?, asOf }`. `asOf` is required: only requests submitted at or before it are approved, so nothing that arrives while the user is deciding is approved unseen. The staff member's own requests are skipped, and so are requests changed in the meantime. At most 200 are approved per call; `remaining` says how many are left.

**Request object (abridged):**

```json
{
  "id": "01a1f505-abf2-7629-90dd-242a404ea7e0",
  "code": "REQ-261119-9F8N",
  "title": "Bulk test VM 2",
  "category": "VM_PROVISIONING",
  "priority": "HIGH",
  "status": "IN_PROGRESS",
  "progress": 50,
  "currentStep": "Creating disk from image",
  "payload": { "environment": "staging", "target": "vm-2" },
  "version": 6,
  "operatorId": "…",
  "approvedById": "…",
  "approvedAt": "2026-11-19T18:17:30.000Z",
  "createdAt": "2026-11-19T18:15:51.000Z",
  "startedAt": "2026-11-19T18:17:30.000Z",
  "completedAt": null,
  "operator": { "id": "…", "fullName": "Dupe Test", "email": "…" }
}
```

## WebSocket events

Connect with Socket.IO to the API origin (`http://localhost:4000`). The handshake is authenticated with the same access token as REST: the browser's cookie (`withCredentials: true`), or `auth: { token }`. Without a valid token the connection is refused with `connect_error` `"unauthorized"`. When the token expires, the server disconnects the socket; refresh the token and reconnect.

```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { withCredentials: true, transports: ["websocket"] });
socket.on("request.changed", ({ request, event }) => console.log(request.code, event.message));
```

| Event (server → client) | Payload | Delivered to |
|---|---|---|
| `request.changed` | `{ request, event }`: the full request after the change, and the timeline event describing it (`eventType`, `fromStatus`, `toStatus`, `progress`, `message`, `actor`, `createdAt`) | All supervisors and admins (room `staff`) and the submitter (room `user:<id>`) |
| `session.changed` | none | The user whose role changed (room `user:<id>`); their sockets are then disconnected so they reconnect with their new role |

`eventType` is one of:

- `created`, `approved`, `rejected`, `cancelled`, `retried`, `updated` (priority) and `note`: changes made by people
- `status_changed`: a worker started, completed or failed the request (see `fromStatus` and `toStatus`)
- `progress_updated`: a step finished (with `progress`)
- `processing`: worker notes, such as a retry being scheduled after a failed attempt The socket is **push-only**: all changes are made through the REST API. The flow is diagrammed in [docs/DESIGN.md §5](docs/DESIGN.md#5-websocket-communication).

## Database

PostgreSQL with five tables: `users`, `sessions`, `requests`, `execution_jobs` and `request_events`. They use foreign keys, CHECK constraints, unique and partial indexes, and a unique partial index that allows only one active job per request. The ERD and design decisions are in [docs/DESIGN.md §3](docs/DESIGN.md#3-database-design).

- **Schema source:** [`backend/src/prisma/contract.prisma`](backend/src/prisma/contract.prisma)
- **Apply migrations:** `cd backend && npx prisma db migrate`
- **Change the schema:**
  1. Edit `contract.prisma`.
  2. `npx prisma contract emit`
  3. `npx prisma migration plan --name <change>`
  4. `npx prisma db migrate --advance-ref db`
- **Reset locally:** `docker compose down -v` (deletes the data volume), then start again from [step 1](#1-database-setup).

## Assumptions

These are summarized here; the full list is in [docs/ANALYSIS.md §1.3](docs/ANALYSIS.md#13-assumptions).

- Processing is **simulated**: each category runs realistic steps with delays and random failures, standing in for real cloud or automation calls.
- One organization and one deployment; users are internal staff signing in with email and password.
- Every request needs approval by someone other than its submitter before it runs.
- PostgreSQL doubles as the job queue; no separate broker is needed at this scale.
- Requests are never hard-deleted, so the history stays intact for audit.
