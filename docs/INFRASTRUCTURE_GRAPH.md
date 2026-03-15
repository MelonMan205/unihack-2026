# Infrastructure Graph (Mid-Level)

Use this Mermaid diagram in the hackathon video to explain the full platform flow without going low-level into code internals.

```mermaid
graph LR
  subgraph USERS
    U1[End users]
    U2[Organizers and admins]
  end

  subgraph APPS
    FE1[Frontend app Next.js React Leaflet]
    FE2[Waitlist site Cloudflare worker]
  end

  subgraph WORKERS
    W1[Scraper worker cron every 2h]
    W2[API worker happs-api route api.happs.dev]
    W3[Notification worker cron every 5 min]
    LOGS[Cloudflare worker logs]
  end

  subgraph SUPABASE
    SA[Supabase Auth JWT sessions]
    S1[Postgres RLS REST RPC]
    T1[events]
    T2[event_crowd_forecasts]
    T3[friendships attendance checkins]
    T4[notifications and device_tokens]
    T5[organizer requests reports event_shares]
    T6[waitlist_signups]
    RPC[app RPC functions]
  end

  subgraph EXTERNAL
    X1[Source event websites]
    X2[Gemini 2.5 Pro API]
    X3[OpenStreetMap Nominatim]
    X4[Photon geocoder]
    X5[Push webhook gateway optional]
    X6[CARTO OSM tile CDN]
  end

  U1 --> FE1
  U2 --> FE1
  U1 --> FE2

  FE1 --> SA
  FE1 --> S1
  FE1 --> RPC
  FE1 --> X6
  FE1 -.-> W2

  W2 --> S1
  W2 --> RPC

  FE2 --> T6

  W1 --> X1
  W1 --> X2
  W1 --> X3
  W1 --> X4
  W1 --> T1

  W3 --> RPC
  RPC --> T2
  RPC --> T3
  W3 --> T4
  W3 --> X5

  S1 --> T1
  S1 --> T2
  S1 --> T3
  S1 --> T4
  S1 --> T5
  S1 --> T6
  S1 --> RPC

  W1 --> LOGS
  W2 --> LOGS
  W3 --> LOGS
```

If Mermaid still does not render in your editor:
- switch preview engine / reopen markdown preview once
- copy the Mermaid block into [mermaid.live](https://mermaid.live) (it should render there)
- keep using this file for narration even if local preview is flaky

## 60-second Narration Script (Optional)

1. Users interact with the Next.js app, which authenticates with Supabase and reads/writes event-social data through RLS-protected tables and RPCs.
2. A scheduled Cloudflare scraper worker ingests public event websites, uses Gemini for resilient structured extraction, geocodes locations, then writes normalized events into Supabase.
3. A second scheduled notification worker runs every 5 minutes to queue reminders, refresh crowd forecasts, expire stale check-ins, and optionally fan out push notifications via webhook.
4. A dedicated API worker exists on `api.happs.dev` for authenticated business actions and admin workflows when we want stricter edge mediation.
5. A separate waitlist worker captures pre-launch signups directly into Supabase, while the map UI uses external CARTO/OSM tiles.
