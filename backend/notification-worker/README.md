# Notification Worker

Cloudflare cron worker for:

- expiring stale check-ins (`app_expire_checkins`)
- dispatching queued notifications from `public.notifications`
- optional push fan-out through `PUSH_WEBHOOK_URL`

## Schedule

Runs every 5 minutes via cron.

## Endpoints

- `GET /health`
- `POST /dispatch` (manual run)

## Required secrets/vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `PUSH_WEBHOOK_URL` (optional external push gateway)
