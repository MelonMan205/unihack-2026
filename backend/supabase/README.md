# Supabase schema deliverables

This folder contains the Supabase schema required for Happs, aligned with the current scraper worker integration.

## Files

- `migrations/001_events.sql`
  - Creates `public.events` with columns matching `backend/worker/index.ts` insert payload.
  - Enables RLS and allows public reads for map/feed.
  - Keeps worker flow unchanged (`service_role` writes via REST).
- `migrations/002_profiles_and_auth_trigger.sql`
  - Creates `public.profiles` linked 1:1 with `auth.users`.
  - Adds trigger `on_auth_user_created` to auto-create profile rows at signup.
- `migrations/003_social_tables.sql`
  - Creates `public.friends`, `public.saved_events`, and `public.rsvps` with RLS policies.
  - Adds friend-based profile visibility policy.
- `migrations/004_waitlist_signups.sql`
  - Creates `public.waitlist_signups` for landing-page waitlist captures.
  - Intended for service-role inserts from `backend/waitlist-worker`.
- `migrations/005_users_spec_foundation.sql`
  - Adds production social/privacy/moderation/notifications schema (`friendships`, `event_attendance`, `event_checkins`, `notifications`, `user_roles`, etc).
  - Adds analytics views and organizer metrics view.
- `migrations/006_users_spec_security_rpc.sql`
  - Adds strict RLS, helper functions, and RPC workflows (friend request lifecycle, attendance updates, check-ins, organizer approvals).
  - Hardens event write policies to organizer/admin roles only.
- `migrations/007_notification_and_forecast_jobs.sql`
  - Adds scheduler RPC jobs for event reminder queueing and crowd forecast refresh.
  - Adds optional `events.start_at/end_at` for time-based reminders.

## Apply migrations

From `backend/supabase` (or repo root):

```powershell
supabase db push
```

If you prefer SQL Editor, run migration files in order:

1. `001_events.sql`
2. `002_profiles_and_auth_trigger.sql`
3. `003_social_tables.sql`
4. `004_waitlist_signups.sql`
5. `005_users_spec_foundation.sql`
6. `006_users_spec_security_rpc.sql`
7. `007_notification_and_forecast_jobs.sql`

## Worker integration (unchanged)

The worker already writes to Supabase via:

- `POST ${SUPABASE_URL}/rest/v1/events`
- `apikey` + `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
- JSON array payload of event rows

No code change is required in `backend/worker/index.ts`.

## Required Supabase Auth config

In Supabase dashboard:

1. Enable Email provider (and optionally Google/Apple) under **Authentication -> Providers**.
2. Set **Site URL** and **Redirect URLs** under **Authentication -> URL Configuration**.

## Frontend integration note

Frontend still needs:

- `@supabase/supabase-js`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then query `public.events` directly for map/feed reads.