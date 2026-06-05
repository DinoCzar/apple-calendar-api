# Smart Events + Apple Calendar

Schedule tasks ("smart events") into free time around your existing Apple Calendar events, then push them back to Apple Calendar so everything appears in one place.

## How it works

1. **Apple events** — Reads busy times from your iCloud calendar named `apple events` via CalDAV.
2. **Smart events** — You create tasks in the web UI (hosted on Render).
3. **Scheduler** — Finds open slots during your work day (e.g. 9 AM–5 PM) when no apple events are scheduled.
4. **Sync** — Pushes scheduled smart events to a separate Apple Calendar called `Smart Events`.

Both calendars show up in the Apple Calendar app on your Mac, iPhone, and iPad.

## Prerequisites

- An Apple ID with **two-factor authentication** enabled
- An **app-specific password** from [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
- A calendar in Apple Calendar named **apple events** (case-insensitive match)
- PostgreSQL (local or Render)

## Local development

```bash
# Copy env and fill in credentials
cp .env.example .env

# Start Postgres (example with Docker)
docker run -d --name smart-events-pg \
  -e POSTGRES_USER=smart_events \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=smart_events \
  -p 5432:5432 postgres:16

# Install, migrate, and run
npm install
npm run db:migrate
npm run dev
```

- API: http://localhost:3000
- UI dev server: http://localhost:5173 (proxies API to :3000)

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, create a **Blueprint** from `render.yaml`, or manually:
   - Create a **PostgreSQL** database
   - Create a **Web Service** (Node) linked to the repo
   - Set `DATABASE_URL` from the database
   - Set `ICLOUD_USERNAME` and `ICLOUD_APP_PASSWORD`
3. Build command: `npm install && npm run build && npm run db:migrate`
4. Start command: `npm start`

## Usage

1. Open the Smart Events web UI.
2. Add tasks with title, duration, and priority (1 = highest).
3. Click **Sync to Calendar** to:
   - Fetch upcoming apple events
   - Schedule pending smart events into free slots
   - Push them to the `Smart Events` calendar in iCloud
4. Use **Reschedule All** to clear existing scheduled/synced events and re-plan from scratch.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Apple events calendar | `apple events` | Source calendar for busy times |
| Smart events calendar | `Smart Events` | Destination calendar (created if missing) |
| Work day | 09:00–17:00 | Scheduling window |
| Schedule ahead | 7 days | How far ahead to plan |
| Gap | 15 min | Buffer between events |
| Timezone | America/Los_Angeles | Used for work-hour boundaries |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/smart-events` | List smart events |
| POST | `/api/smart-events` | Create smart event |
| PATCH | `/api/smart-events/:id` | Update smart event |
| DELETE | `/api/smart-events/:id` | Delete smart event |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/calendars` | List iCloud calendars |
| POST | `/api/sync` | Run schedule + sync (`{ "reschedule": true }` to replan) |
| GET | `/api/sync/preview` | Preview upcoming apple events |

## Notes

- Apple does not provide a REST API for Calendar; this app uses **CalDAV** (`caldav.icloud.com`).
- Calendar names are matched case-insensitively.
- Smart events are written to a separate calendar so they don’t mix with your original apple events.
