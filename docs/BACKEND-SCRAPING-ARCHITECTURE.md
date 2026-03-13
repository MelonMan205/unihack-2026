# Backend & Smart Scraping Architecture

One **Cloudflare Worker** runs the scraping pipeline on a **self-scheduled cron**, posts extracted events into **Supabase**, and the **frontend talks to Supabase directly** (no separate read API). Uses **Gemini 2.5 Pro** + **HTMLRewriter** for site-agnostic extraction and traversal. 
---

## 1. What the backend should do

- **Fetch** event/venue pages from many different websites (no single DOM structure).
- **Normalize** HTML (strip scripts, ads, nav, footers) so the model sees mostly content.
- **Extract** structured data (title, venue, time, **description**, location, category, tags) and **discover links** to more event/venue pages.
- **Traverse** sites from seed URLs → follow relevant links → **post results into Supabase.**

Your frontend already expects something like `EventPin` (and can be extended with a `description` field). The Worker’s job is to fill Supabase from arbitrary sites; the app reads from Supabase only.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKER (single worker, cron-scheduled)                       │
│  - Cron Trigger runs on schedule (e.g. every 15 min)                     │
│  - Reads "to_crawl" / seed URLs from Supabase (or env/config)            │
│  - For each URL: fetch -> HTMLRewriter -> Gemini -> extract               │
│  - POST extracted events into Supabase (events table)                    │
│  - Push new links into Supabase (crawl_queue or same table) for next run  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  GEMINI 2.5 PRO (vision + structured output)                             │
│  - Input: cleaned HTML (and optionally image if you add screenshot flow)  │
│  - Prompt: “Extract events/venues and list internal links to more pages” │
│  - Output: JSON matching your schema (EventPin + description + links)    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SUPABASE                    │   FRONTEND                  │
│  - events (insert)            │   Supabase client -> map    │
│  - crawl_queue (optional)     │   (no Worker API in path)   │
└──────────────────────────────┴─────────────────────────────┘
```

---

## 3. Where everything lives

| Component | Where | Why |
|-----------|--------|-----|
| **Scraping pipeline** | **Single Cloudflare Worker** | Fetch, HTMLRewriter, Gemini call, and Supabase insert all in one Worker. |
| **Schedule** | **Worker Cron Trigger** | Cron runs the Worker on a schedule (e.g. every 15 min). No separate scheduler. |
| **Event storage** | **Supabase** | Worker POSTs/inserts extracted events (and descriptions) into a Supabase table. |
| **Crawl state (seeds + queue)** | **Supabase** | Optional table (e.g. `crawl_queue` or `seed_urls`) for URLs to crawl and dedup; Worker reads next N URLs each cron run and appends new links. |
| **Frontend data** | **Supabase only** | App uses Supabase client; no read API on the Worker. Real-time or simple select for the map. |

**Summary:** One Worker (cron) → Supabase. Frontend → Supabase. No extra services.

---

## 4. How “smart scraping” works (Worker + HTMLRewriter + Gemini)

### 4.1 Role of each piece

- **Worker:** Fetch the page, normalize HTML, call Gemini, post results to Supabase, enqueue discovered links (in Supabase).
- **HTMLRewriter (Cloudflare):** Stream through the HTML and remove or replace nodes (scripts, styles, nav, footer, ads). You can also use it to keep only a single “content” container (e.g. first `main` or `article`) so you send less noise to Gemini and stay under token limits.
- **Gemini 2.5 Pro:** Consumes the cleaned HTML (and optionally an image if you add a screenshot step). Uses **vision + reasoning** to interpret varied layouts and **structured output** (JSON schema) so you get a fixed shape (e.g. `EventPin` + `description` + `links[]`) regardless of site structure — **site-agnostic extraction**.

### 4.2 Flow in code (conceptual)

1. **Worker** receives a URL (from queue or HTTP).
2. `fetch(url)` with a normal User-Agent (and optional timeout).
3. Pass the `Response` body through **HTMLRewriter**:
   - Remove `script`, `style`, `nav`, `footer`, common ad/analytics divs.
   - Optionally keep only one main content block (e.g. `main` or first `article`) and drop the rest.
4. Collect the rewritten HTML into a string (or stream). If the page is huge, truncate or split and send the first chunk(s) to Gemini (Gemini 2.5 Pro has a large context window).
5. Call **Gemini 2.5 Pro** with:
   - **System/user prompt:** “You are an extractor. Given the HTML of an event or venue page, extract: event title, venue name, time, description (full text for the event/venue), location if present, category, tags. Also list any internal links that look like other event or venue pages (same domain).”
   - **Structured output:** JSON schema matching your type (e.g. `{ events: [...], description?: string, links: string[] }`). Use [Structured Output](https://ai.google.dev/gemini-api/docs/structured-output) (e.g. with Zod on the Worker) so you always get valid JSON.
6. From the response: **insert** events/descriptions into Supabase; **push** any new links from `links[]` into a Supabase crawl table/queue (with deduplication by URL).

### 4.3 When to use vision (screenshots)

- **HTML-only** is enough for most sites: Gemini can infer structure from cleaned HTML. Use this first (cheaper, faster).
- **Vision** is useful when:
  - The site is heavily JS-rendered and your Worker only gets a shell (then you’d need a separate headless/screenshot service and pass the image to Gemini), or
  - You explicitly want “what a user sees” (e.g. hero image + layout) for extraction.  
For “collect descriptions and traverse,” starting with **HTML + structured extraction** is the right default; add vision later if you hit JS-heavy sites.

---

## 5. Making scraping site-agnostic

- **No site-specific selectors:** Don’t rely on one site’s class names or DOM. Let Gemini understand the page semantically.
- **Single schema:** Define one extraction schema (e.g. EventPin + `description`) and use it for every URL. Gemini maps different page layouts to the same schema.
- **Prompt design:** In the prompt, describe the **intent** (e.g. “event title”, “venue name”, “full description of the event or venue”, “links to more event/venue pages on this domain”) and optionally give 1–2 examples. Mention that HTML may be from different sites with different structures.
- **Fallbacks:** In the schema, mark fields as optional (e.g. `description?`, `location?`) so a page that only has a title and one paragraph still returns something useful.
- **Normalize later:** You can add a small “normalize” step (e.g. map free-text “time” to your `timeLabel`, or infer `category` from tags) in the Worker before storing.

---

## 6. Traversing sites to collect descriptions

- **Seeds:** Start from a small list of URLs you know are event listings or venue pages (e.g. “tonight” or “events” pages for a city). Store these in Supabase (e.g. `seed_urls` or `crawl_queue`) or in Worker env/config.
- **Per-page extraction:** Each page returns (from Gemini) both **structured data (including description)** and **links** that look like other event/venue pages.
- **Queue + dedup:** For each extracted link:
  - Normalize URL (same origin, strip fragments, maybe strip query params that are only tracking).
  - Check if already in “crawled” or “to_crawl” (e.g. in D1 or KV).
  - If new, add to “to_crawl” (or push to Cloudflare Queue).
- **Traversal policy:** Process “to_crawl” in batches (e.g. Worker cron every 5 minutes, or HTTP-triggered). Limit depth (e.g. same domain, max 2–3 hops from seed) and **per-domain rate limit** (e.g. 1 request per second per hostname) to avoid overloading sites.
- **Stop conditions:** Stop when queue is empty, or max events per run, or max depth reached. You can re-seed periodically to discover new events.

This gives you **site-agnostic traversal**: the same pipeline works for any site; Gemini decides what is an event/venue and what links to follow.

---

## 7. Suggested stack summary

| Concern | Choice |
|--------|--------|
| **Fetch + clean HTML** | Cloudflare Worker + HTMLRewriter |
| **Extract (site-agnostic)** | Gemini 2.5 Pro with structured output + one schema |
| **Traversal** | Seed URLs + link extraction from Gemini + Supabase crawl table + dedup + per-domain rate limit |
| **Storage** | Supabase for events/descriptions and optional crawl queue |
| **Deploy** | One Cloudflare Worker on cron; frontend talks to Supabase only |
| **Vision** | Use when you need it (e.g. JS-heavy or “what you see”); start with HTML-only |

---

## 8. Next steps

1. **Extend `EventPin`** in the frontend (e.g. add `description?: string`) and keep mock data working.
2. **Create Supabase tables:** e.g. `events` (id, title, venue, time_label, photo_url, location, category, spontaneity_score, crowd_label, tags, description, source_url, created_at) and optionally `crawl_queue` (url, status, created_at).
3. **Create the Worker** that: on cron, reads next URLs from Supabase (or seed list) → fetch → HTMLRewriter (strip junk, optionally keep `<main>`) → call Gemini with your schema → insert events into Supabase and new links into crawl table with dedup.
4. **Frontend:** Add `@supabase/supabase-js`, point the app at your Supabase project, and query `events` (e.g. with optional geo filter) instead of mock data. No read API on the Worker.
5. **Optional:** Add a screenshot pipeline and send images to Gemini for difficult JS-only sites.

If you want, the next step can be a minimal Worker skeleton (cron handler, fetch + HTMLRewriter + Gemini, Supabase insert) and a Zod schema that matches your `EventPin` + `description` + `links`.
