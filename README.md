# Smart Events + Apple Calendar

Schedule tasks ("smart events") into free time around your existing iCloud calendars, then push them to a **Smart Events** calendar in Apple Calendar.

## How it works

1. **Busy times** — Reads events from all iCloud calendars (except the Smart Events output calendar) via CalDAV.
2. **Smart events** — You create and prioritize tasks in the web UI.
3. **Scheduler** — Fills open slots during your work day (default 8 AM–9 PM) when nothing else is scheduled.
4. **Sync** — Replaces old smart events and pushes the new schedule to your **Smart Events** calendar.

The UI and API run together as one web service, so you can open the app from any browser once it is deployed.

## Prerequisites

- An Apple ID with **two-factor authentication** enabled
- An **app-specific password** from [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords (used for CalDAV sync only)
- A calendar in Apple Calendar named **Smart Events** (create it manually if it does not exist)
- A [Turso](https://turso.tech) database (free tier — no 30-day expiry like Render Postgres)

## Local development

```bash
cp .env.example .env
# Fill in TURSO_*, ICLOUD_*, AUTH_*, and SESSION_SECRET
```

For local-only dev without Turso Cloud, set `TURSO_DATABASE_URL=file:smart_events.db` and leave `TURSO_AUTH_TOKEN` empty.

```bash
npm install
npm run dev
```

- UI: http://localhost:5173 (proxies API to the server)
- API: http://localhost:3000

Sign in with your Apple ID email and **main Apple ID password** (`AUTH_PASSWORD`). CalDAV sync uses the app-specific password (`ICLOUD_APP_PASSWORD`).

## Deploy to Render

### 1. Create a Turso database

Install the [Turso CLI](https://docs.turso.tech/cli/installation), sign in, then:

```bash
turso auth login
turso db create smart-events
turso db show smart-events --url
turso db tokens create smart-events
```

Copy the database URL (`libsql://…`) and auth token into your env vars below.

Tables are created automatically on first server boot (`initDb`).

### 2. Push to GitHub

The repo must be on GitHub (already configured in `render.yaml`).

### 3. Create or update the Blueprint

1. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the `apple-calendar-api` repo
3. Render creates the **Web Service** only (no expiring Postgres database)

If you already deployed with the old Render Postgres database, delete the old `smart-events-db` instance after migrating to Turso to avoid confusion.

### 4. Set secret environment variables

In the web service → **Environment**, add:

| Variable | Value |
|----------|-------|
| `TURSO_DATABASE_URL` | From `turso db show smart-events --url` |
| `TURSO_AUTH_TOKEN` | From `turso db tokens create smart-events` |
| `ICLOUD_USERNAME` | Your Apple ID email |
| `ICLOUD_APP_PASSWORD` | App-specific password (for calendar sync) |
| `AUTH_USERNAME` | Same Apple ID email (optional if same as `ICLOUD_USERNAME`) |
| `AUTH_PASSWORD` | Your main Apple ID password (for site login) |
| `SESSION_SECRET` | Long random string — run `openssl rand -base64 32` |

### 5. Deploy

Render runs `npm ci --include=dev && npm run build`, then `npm start`. The server:

- Creates Turso/SQLite tables on first boot
- Serves the React UI at your Render URL (e.g. `https://smart-events.onrender.com`)
- Protects all routes behind login

Open your Render URL in any browser, sign in, and use the app.

### 6. First-time calendar setup

In Apple Calendar on your Mac or iPhone, create a calendar named **Smart Events** if it is not already there. After signing in, use **Refresh calendars** in Settings to select it as the output calendar.

## Usage

1. Sign in with your Apple ID email and password.
2. Add smart events with title and duration.
3. Drag to set priority (top = highest).
4. Click **Sync Smart Events** to reschedule and push to iCloud.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Smart events calendar | `Smart Events` | Destination calendar in iCloud |
| Work day | 08:00–21:00 | Scheduling window |
| Schedule ahead | 7 days | How far ahead to plan |
| Gap | 15 min | Buffer between events |
| Timezone | America/Los_Angeles | Used for work-hour boundaries |

## API

All routes except `/api/health` and `/api/auth/*` require a logged-in session cookie.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user |
| GET | `/api/smart-events` | List smart events |
| POST | `/api/smart-events` | Create smart event |
| PATCH | `/api/smart-events/:id` | Update smart event |
| DELETE | `/api/smart-events/:id` | Delete smart event |
| PUT | `/api/smart-events/reorder` | Reorder by priority |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/calendars` | List iCloud calendars |
| POST | `/api/sync` | Run schedule + sync |
| GET | `/api/sync/preview` | Preview busy times |

## Notes

- Apple Calendar has no public REST API; this app uses **CalDAV** (`caldav.icloud.com`).
- Site login uses your main Apple ID password; CalDAV requires the app-specific password.
- On Render free tier, the web service may sleep after inactivity — the first page load can take ~30 seconds. Turso stays awake and does not expire on the free tier.
