# Production Release Checklist

This checklist maps the USERS_SPEC rollout to concrete deployment steps.

## 1) Database Migration Order

Apply in order:

1. `backend/supabase/migrations/001_events.sql`
2. `backend/supabase/migrations/002_profiles_and_auth_trigger.sql`
3. `backend/supabase/migrations/003_social_tables.sql`
4. `backend/supabase/migrations/004_waitlist_signups.sql`
5. `backend/supabase/migrations/005_users_spec_foundation.sql`
6. `backend/supabase/migrations/006_users_spec_security_rpc.sql`
7. `backend/supabase/migrations/007_notification_and_forecast_jobs.sql`

## 2) Required Runtime Config

### Frontend (`frontend/.env.local`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

### API Worker (`backend/api-worker`)

- Public API domain: `https://api.happs.dev`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `RATE_LIMIT_PER_MINUTE` (optional)

### Notification Worker (`backend/notification-worker`)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `PUSH_WEBHOOK_URL` (optional; if omitted, notifications are still marked as sent in-app)

## 3) Worker Deploy Commands

From each worker directory:

```powershell
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler deploy
```

Use `wrangler secret put` for secrets and `wrangler.toml` vars for non-secret values.

### API domain routing (Cloudflare)

- Ensure `happs.dev` is in the same Cloudflare account as the Worker.
- API worker is configured with route: `api.happs.dev/*`.
- Add DNS record:
  - Type: `CNAME`
  - Name: `api`
  - Target: `happs-api.<your-subdomain>.workers.dev`
  - Proxy status: **Proxied** (orange cloud)

## 4) Feature Flags / Rollout Stages

Recommended phased release:

1. **Auth + onboarding gate**
2. **Friends + attendance + saved events**
3. **Organizer verification + organizer dashboard**
4. **Admin moderation workflows**
5. **Notification cron + crowd forecasts**

If needed, temporarily hide entrypoints in homepage navigation until each stage is validated.

## 5) Security Hardening Checks

- Confirm OAuth providers (Google + Apple) are enabled in Supabase Auth.
- Confirm email verification is enabled in Supabase Auth settings.
- Ensure worker secrets are set using Wrangler secrets (not checked into repo).
- Ensure no service-role key is exposed to frontend.
- Verify RLS policies are enabled on all new tables.

## 6) Smoke Test Script (Manual)

1. Create account with email/password.
2. Complete onboarding (>=3 interests).
3. Send friend request and accept from second account.
4. Mark event attendance (`interested`, `going`, `not_going`, `ghost`) and verify visibility behavior.
5. Save/unsave event and verify in `/saved`.
6. Submit organizer verification request.
7. Approve organizer request via `/admin`.
8. Create organizer event and confirm map rendering.
9. Trigger `/dispatch` on notification worker and verify notification records update.

## 7) Rollback Plan

- Roll back frontend deploy first.
- Disable worker routes if business endpoints are unstable.
- For DB rollbacks, prefer forward-fix migration over destructive schema rollback.
