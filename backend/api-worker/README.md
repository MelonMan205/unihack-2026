# API Worker

Cloudflare Worker dedicated to authenticated product actions that should not live directly in the browser.

## Endpoints

- `GET /health`
- `POST /friend/request`
- `POST /friend/respond`
- `POST /friend/block`
- `POST /attendance/set`
- `POST /checkin/create`
- `POST /organizer/request`
- `POST /share/event`
- `POST /report/create`
- `POST /admin/organizer/review`
- `POST /admin/checkins/expire`

All POST endpoints require:

- `Authorization: Bearer <supabase-access-token>`
- `Content-Type: application/json`

## Env vars

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `RATE_LIMIT_PER_MINUTE` (optional, default `80`)

## Notes

- This worker relies on Supabase RLS + RPC from migrations `005` and `006`.
- Keep scraper logic in `backend/worker`; this service handles user/business workflows only.
