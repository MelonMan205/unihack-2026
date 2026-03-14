# Waitlist Worker

Cloudflare Worker that serves a styled waitlist page and writes submissions into Supabase (`public.waitlist_signups`).

## 1) Apply Supabase migration

From repo root:

```powershell
supabase db push
```

Or run `backend/supabase/migrations/004_waitlist_signups.sql` in Supabase SQL Editor.

## 2) Configure secrets

From `backend/waitlist-worker`:

```powershell
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_URL` is already set in `wrangler.toml`.

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill your key.

## 3) Run locally

```powershell
wrangler dev
```

Open the local URL and submit the form.

## 4) Deploy

```powershell
wrangler deploy
```

## Data access

Check submissions in Supabase table:

- `public.waitlist_signups`

You can view it in Table Editor or query:

```sql
select *
from public.waitlist_signups
order by created_at desc;
```
