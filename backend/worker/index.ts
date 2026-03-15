import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_PULISHABLE_KEY?: string;
}

type ResolvedEnv = {
  geminiKey: string;
  cloudflareAccountId: string;
  cloudflareToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

type EventCandidate = {
  url: string;
  score: number;
};

type ParsedEvent = {
  event_name: string | null;
  description: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  venue: string | null;
  category: string | null;
  tags: string[] | null;
  image_url: string | null;
  source_url: string;
};

type NormalizedEvent = {
  title: string;
  venue: string | null;
  timeLabel: string;
  startAtIso: string;
  startEpochMs: number;
  description: string | null;
  sourceUrl: string;
  source: string;
  photoUrl: string | null;
  location: string; // lat,long
  category: string | null;
  tags: string[];
  priceTier: "free" | "budget" | "mid" | "premium" | "unknown";
  alcoholPolicy: "alcoholic" | "non_alcoholic" | "mixed" | "unknown";
  isSports: boolean;
  subcategories: string[];
  rawLocation: string;
  date: string;
  time: string;
};

type SupabaseEventRow = {
  title: string;
  venue: string | null;
  time_label: string;
  start_at: string;
  description: string | null;
  source_url: string;
  source: string;
  photo_url: string | null;
  location: string; // lat,long
  category: string | null;
  tags: string[];
  price_tier: "free" | "budget" | "mid" | "premium" | "unknown";
  alcohol_policy: "alcoholic" | "non_alcoholic" | "mixed" | "unknown";
  is_sports: boolean;
  subcategories: string[];
  spontaneity_score: number | null;
  crowd_label: "quiet" | "moderate" | "busy" | "packed" | null;
};

type InvalidEventDebug = {
  sourceUrl: string;
  eventUrl: string;
  reason: string;
  locationRaw: string | null;
  parsed: ParsedEvent | null;
};

type ProgressEntry = {
  ts: string;
  stage:
    | "init"
    | "source.fetch_listing"
    | "source.discover_links"
    | "source.select_event_pages"
    | "event.render_pdf"
    | "event.parse_gemini"
    | "event.extract_image"
    | "event.validate"
    | "event.geocode"
    | "events.insert"
    | "events.cleanup"
    | "done"
    | "error";
  status: "info" | "ok" | "warn" | "error";
  message: string;
  sourceUrl?: string;
  eventUrl?: string;
  meta?: Record<string, unknown>;
};

type PipelineResult = {
  ok: boolean;
  count: number;
  insertedCount: number;
  cleanedExpiredCount: number;
  events: NormalizedEvent[];
  invalidEvents: InvalidEventDebug[];
  warning: string | null;
  warnings: string[];
  progress: ProgressEntry[];
  errors: string[];
};

type GeocodeResult = {
  lat: number;
  lng: number;
  text: string;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
const USER_AGENT = "Mozilla/5.0 (compatible; UniHackEventWorker/1.0)";
const OSM_USER_AGENT = "UniHackEventWorker/1.0 (contact: unihack-events@example.com)";
const MAX_CANDIDATES_PER_SOURCE = 90;
const MAX_EVENT_PAGES_PER_SOURCE = 50;
const ROBOTS_CONCURRENCY = 4;
const EVENT_PROCESS_CONCURRENCY = 2;
const CF_MAX_RETRIES = 5;
const CF_BASE_BACKOFF_MS = 1200;
const CF_MAX_BACKOFF_MS = 20000;
const GEOCODE_MIN_GAP_MS = 1100;
const DEFAULT_EVENT_TIMEZONE = "Australia/Melbourne";

const robotsCache = new Map<string, boolean>();
let nextGeocodeAt = 0;
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function nowIso(): string {
  return new Date().toISOString();
}

function clip(s: string, n = 260): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushProgress(progress: ProgressEntry[], entry: Omit<ProgressEntry, "ts">): void {
  const withTs: ProgressEntry = { ts: nowIso(), ...entry };
  progress.push(withTs);
  console.log(`[progress] ${withTs.stage} ${withTs.status}`, withTs.eventUrl || withTs.sourceUrl || "", withTs.message);
}

function readEnv(env: Env): ResolvedEnv {
  const resolved: ResolvedEnv = {
    geminiKey: (env.GEMINI_API_KEY || "").trim(),
    cloudflareAccountId: (env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    cloudflareToken: (env.CLOUDFLARE_API_TOKEN || "").trim(),
    supabaseUrl: (env.SUPABASE_URL || "").trim(),
    supabaseServiceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };

  if (!resolved.geminiKey) throw new Error("Missing GEMINI_API_KEY");
  if (!resolved.cloudflareAccountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!resolved.cloudflareToken) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!resolved.supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!resolved.supabaseServiceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return resolved;
}

function getConfiguredUrls(): string[] {
  const raw = Array.isArray((urlsConfig as { urls?: unknown[] })?.urls)
    ? (urlsConfig as { urls: unknown[] }).urls
    : Array.isArray(urlsConfig)
      ? (urlsConfig as unknown[])
      : [];

  return raw
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed fetch ${url} status=${res.status}`);
  return res.text();
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] || "").trim();
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    const full = normalizeUrl(baseUrl, href);
    if (full) links.add(full);
  }
  return Array.from(links);
}

function extractLinksFromSitemapXml(xml: string): string[] {
  const links = new Set<string>();
  const re = /<loc>(.*?)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = (m[1] || "").trim();
    if (u.startsWith("http://") || u.startsWith("https://")) links.add(u);
  }
  return Array.from(links);
}

function scoreEventLikeUrl(url: string, sourceHost: string): EventCandidate | null {
  const u = url.toLowerCase();
  let score = 0;
  const pos = ["event", "events", "whatson", "whats-on", "calendar", "festival", "gig", "seminar", "workshop", "meetup", "ticket"];
  const neg = ["login", "signup", "privacy", "terms", "contact", "about", "faq", "facebook.com", "instagram.com", "twitter.com", "linkedin.com"];
  for (const p of pos) if (u.includes(p)) score += 2;
  for (const n of neg) if (u.includes(n)) score -= 3;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === sourceHost) score += 2;
    if (parsed.pathname.split("/").filter(Boolean).length >= 2) score += 1;
  } catch {
    return null;
  }
  if (score <= 0) return null;
  return { url, score };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  async function runOne() {
    while (idx < items.length) {
      const current = idx++;
      out[current] = await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, () => runOne());
  await Promise.all(workers);
  return out;
}

async function isAllowedByRobots(pageUrl: string): Promise<boolean> {
  try {
    const u = new URL(pageUrl);
    const key = `${u.protocol}//${u.host}${u.pathname}`;
    const cached = robotsCache.get(key);
    if (typeof cached === "boolean") return cached;

    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const res = await fetch(robotsUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      robotsCache.set(key, true);
      return true;
    }
    const txt = (await res.text()).toLowerCase();
    const path = u.pathname.toLowerCase();
    let inStar = false;
    const disallow: string[] = [];
    for (const lineRaw of txt.split("\n")) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("user-agent:")) {
        inStar = (line.split(":")[1] || "").trim() === "*";
      } else if (inStar && line.startsWith("disallow:")) {
        const rule = (line.split(":")[1] || "").trim();
        if (rule) disallow.push(rule);
      }
    }
    for (const rule of disallow) {
      if (rule === "/" || path.startsWith(rule)) {
        robotsCache.set(key, false);
        return false;
      }
    }
    robotsCache.set(key, true);
    return true;
  } catch {
    return true;
  }
}

async function discoverEventCandidates(sourceUrl: string, progress: ProgressEntry[]): Promise<EventCandidate[]> {
  pushProgress(progress, { stage: "source.fetch_listing", status: "info", sourceUrl, message: "Fetching listing HTML" });
  const listingHtml = await fetchText(sourceUrl);
  pushProgress(progress, { stage: "source.discover_links", status: "info", sourceUrl, message: "Extracting and scoring candidate links" });

  const sourceHost = new URL(sourceUrl).hostname;
  const listingLinks = extractLinksFromHtml(listingHtml, sourceUrl).slice(0, MAX_CANDIDATES_PER_SOURCE);
  let pool = listingLinks;
  if (pool.length < Math.floor(MAX_CANDIDATES_PER_SOURCE * 0.75)) {
    try {
      const u = new URL(sourceUrl);
      const sitemapXml = await fetchText(`${u.protocol}//${u.host}/sitemap.xml`);
      const sitemapLinks = extractLinksFromSitemapXml(sitemapXml);
      pool = Array.from(new Set([...pool, ...sitemapLinks])).slice(0, MAX_CANDIDATES_PER_SOURCE);
    } catch {
      // Optional sitemap.
    }
  }

  const scored = pool
    .map((url) => scoreEventLikeUrl(url, sourceHost))
    .filter((c): c is EventCandidate => Boolean(c))
    .sort((a, b) => b.score - a.score);

  const allowedFlags = await mapWithConcurrency(scored, ROBOTS_CONCURRENCY, async (c) => isAllowedByRobots(c.url));
  const allowed: EventCandidate[] = [];
  for (let i = 0; i < scored.length; i++) if (allowedFlags[i]) allowed.push(scored[i]);
  pushProgress(progress, { stage: "source.select_event_pages", status: "ok", sourceUrl, message: `Discovered ${allowed.length} robots-allowed candidates` });
  return allowed;
}

async function collectEventPagesWithFallback(
  candidates: EventCandidate[],
  sourceUrl: string,
  progress: ProgressEntry[]
): Promise<Array<{ eventUrl: string; html: string; score: number }>> {
  const selected: Array<{ eventUrl: string; html: string; score: number }> = [];
  for (const candidate of candidates) {
    if (selected.length >= MAX_EVENT_PAGES_PER_SOURCE) break;
    try {
      const html = await fetchText(candidate.url);
      selected.push({ eventUrl: candidate.url, html, score: candidate.score });
      pushProgress(progress, {
        stage: "source.select_event_pages",
        status: "ok",
        sourceUrl,
        eventUrl: candidate.url,
        message: `Accepted event page ${selected.length}/${MAX_EVENT_PAGES_PER_SOURCE}`,
        meta: { score: candidate.score },
      });
    } catch (err) {
      pushProgress(progress, {
        stage: "source.select_event_pages",
        status: "warn",
        sourceUrl,
        eventUrl: candidate.url,
        message: `Event page HTML fetch failed; trying next candidate (${clip(String(err), 180)})`,
      });
    }
  }
  return selected;
}

function getRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("Retry-After");
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(CF_BASE_BACKOFF_MS * 2 ** (attempt - 1), CF_MAX_BACKOFF_MS);
  return exp + Math.floor(Math.random() * 350);
}

async function renderPdfViaCloudflare(pageUrl: string, env: ResolvedEnv): Promise<Uint8Array> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/browser-rendering/pdf`;
  let lastErr = "";
  for (let attempt = 1; attempt <= CF_MAX_RETRIES; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.cloudflareToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const body = await res.text();
    lastErr = `Cloudflare PDF failed ${res.status}: ${clip(body, 500)}`;
    if (res.status !== 429 || attempt === CF_MAX_RETRIES) throw new Error(lastErr);
    await sleep(getRetryAfterMs(res.headers) ?? computeBackoffMs(attempt));
  }
  throw new Error(lastErr || "Cloudflare PDF failed");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode(...part);
  }
  return btoa(bin);
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeDateToDdMmYyyy(input: string): string | null {
  const raw = input.trim().replace(/\s+/g, " ");
  const slashOrDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

  let day = 0;
  let month = 0;
  let year = 0;

  let m = slashOrDash.exec(raw);
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  } else {
    m = ymd.exec(raw);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
    } else {
      const long = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/;
      const short = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
      const months: Record<string, number> = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12,
      };

      const ml = long.exec(raw);
      if (ml) {
        month = months[(ml[1] || "").toLowerCase()] || 0;
        day = Number(ml[2]);
        year = Number(ml[3]);
      } else {
        const ms = short.exec(raw);
        if (ms) {
          day = Number(ms[1]);
          month = months[(ms[2] || "").toLowerCase()] || 0;
          year = Number(ms[3]);
        }
      }
    }
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utcCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    utcCheck.getUTCFullYear() !== year ||
    utcCheck.getUTCMonth() + 1 !== month ||
    utcCheck.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function normalizeTimeTo24Hour(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "all day" || raw === "tba" || raw === "to be announced") return "00:00";

  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(raw.replace(/\./g, ""));
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] || "0");
    const marker = (ampm[3] || "").toLowerCase();
    if (minute < 0 || minute > 59 || hour < 1 || hour > 12) return null;
    if (marker === "pm" && hour !== 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const twentyFour = /^(\d{1,2})[:.](\d{2})$/.exec(raw);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const hourOnly = /^(\d{1,2})$/.exec(raw);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour < 0 || hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  return null;
}

function formatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  dateFormatterCache.set(timeZone, formatter);
  return formatter;
}

function offsetForTimeZone(utcMs: number, timeZone: string): number {
  const parts = formatterForTimeZone(timeZone).formatToParts(new Date(utcMs));
  const values: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === "literal") continue;
    values[p.type] = Number(p.value);
  }
  const asIfUtc = Date.UTC(
    values.year ?? 0,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0
  );
  return asIfUtc - utcMs;
}

function zonedDateTimeToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetFirst = offsetForTimeZone(utcGuess, timeZone);
  let resolved = utcGuess - offsetFirst;
  const offsetSecond = offsetForTimeZone(resolved, timeZone);
  if (offsetSecond !== offsetFirst) {
    resolved = utcGuess - offsetSecond;
  }
  return resolved;
}

function buildEventDateTime(dateText: string, timeText: string): { dateDdMmYyyy: string; time24: string; epochMs: number; iso: string } | null {
  const dateDdMmYyyy = normalizeDateToDdMmYyyy(dateText);
  const time24 = normalizeTimeTo24Hour(timeText);
  if (!dateDdMmYyyy || !time24) return null;

  const [dd, mm, yyyy] = dateDdMmYyyy.split("/").map(Number);
  const [hour, minute] = time24.split(":").map(Number);
  if (!dd || !mm || !yyyy || Number.isNaN(hour) || Number.isNaN(minute)) return null;

  const epochMs = zonedDateTimeToEpochMs(yyyy, mm, dd, hour, minute, DEFAULT_EVENT_TIMEZONE);
  return {
    dateDdMmYyyy,
    time24,
    epochMs,
    iso: new Date(epochMs).toISOString(),
  };
}

async function parseEventPdfWithGemini(pdfBytes: Uint8Array, sourceUrl: string, env: ResolvedEnv): Promise<ParsedEvent> {
  const prompt =
    "Extract event details from this PDF and return JSON only (no markdown) with keys: " +
    '{"event_name":string|null,"description":string|null,"date":string|null,"time":string|null,"location":string|null,"venue":string|null,"category":string|null,"tags":string[]|null,"image_url":string|null,"source_url":string}. ' +
    "Use date format strictly DD/MM/YYYY and time as 24-hour HH:mm when possible. " +
    `Set source_url="${sourceUrl}".`;

  const res = await fetch(`${GEMINI_URL}?key=${env.geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "application/pdf", data: toBase64(pdfBytes) } },
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini failed ${res.status}: ${clip(text, 700)}`);
  const data = JSON.parse(text);
  const modelText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = modelText.trim();

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) throw new Error(`Could not parse Gemini JSON: ${clip(raw, 200)}`);
    obj = JSON.parse(raw.slice(s, e + 1));
  }

  return {
    event_name: asStringOrNull(obj?.event_name),
    description: asStringOrNull(obj?.description),
    date: asStringOrNull(obj?.date),
    time: asStringOrNull(obj?.time),
    location: asStringOrNull(obj?.location),
    venue: asStringOrNull(obj?.venue),
    category: asStringOrNull(obj?.category),
    tags: Array.isArray(obj?.tags) ? obj.tags.filter((t: unknown) => typeof t === "string").map((t: string) => t.trim()).filter(Boolean) : null,
    image_url: asStringOrNull(obj?.image_url),
    source_url: sourceUrl,
  };
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string | null {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  return re.exec(html)?.[1]?.trim() || null;
}

function extractBestImageUrl(html: string, pageUrl: string): string | null {
  const og = extractMetaContent(html, "property", "og:image");
  if (og) return normalizeUrl(pageUrl, og) || og;
  const tw = extractMetaContent(html, "name", "twitter:image");
  if (tw) return normalizeUrl(pageUrl, tw) || tw;
  const img = /<img[^>]+src=["']([^"']+)["'][^>]*>/i.exec(html)?.[1];
  return img ? normalizeUrl(pageUrl, img) : null;
}

function parseLatLngText(input: string): GeocodeResult | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(input.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, text: `${lat.toFixed(6)},${lng.toFixed(6)}` };
}

function toValidGeocode(latRaw: unknown, lngRaw: unknown): GeocodeResult | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, text: `${lat.toFixed(6)},${lng.toFixed(6)}` };
}

async function geocodeViaNominatim(query: string): Promise<{ forbidden: boolean; value: GeocodeResult | null }> {
  const endpoint =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&countrycodes=au&email=unihack-events@example.com&q=" +
    encodeURIComponent(query);
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": OSM_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-AU,en;q=0.9",
    },
  });
  if (res.status === 403) return { forbidden: true, value: null };
  if (!res.ok) return { forbidden: false, value: null };
  const payload = (await res.json()) as any[];
  if (!Array.isArray(payload) || payload.length === 0) return { forbidden: false, value: null };
  return { forbidden: false, value: toValidGeocode(payload[0]?.lat, payload[0]?.lon) };
}

async function geocodeViaPhoton(query: string): Promise<GeocodeResult | null> {
  const endpoint = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": OSM_USER_AGENT } });
  if (!res.ok) return null;
  const payload = (await res.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
  const coords = payload?.features?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return toValidGeocode(coords[1], coords[0]);
}

async function geocodeToLatLng(locationText: string): Promise<GeocodeResult | null> {
  const direct = parseLatLngText(locationText);
  if (direct) return direct;

  const cleaned = locationText.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
  const simplified = cleaned.replace(/^the\s+/i, "").replace(/\([^)]*\)/g, "").trim();
  const shortComma = simplified.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4).join(", ");
  const queries = Array.from(new Set([cleaned, simplified, shortComma])).filter(Boolean);

  let sawForbidden = false;
  for (const query of queries) {
    const waitFor = nextGeocodeAt - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    nextGeocodeAt = Date.now() + GEOCODE_MIN_GAP_MS;
    const lookup = await geocodeViaNominatim(query);
    if (lookup.forbidden) {
      sawForbidden = true;
      continue;
    }
    if (lookup.value) return lookup.value;
  }

  if (sawForbidden) {
    for (const query of queries) {
      const waitFor = nextGeocodeAt - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      nextGeocodeAt = Date.now() + GEOCODE_MIN_GAP_MS;
      const fallback = await geocodeViaPhoton(query);
      if (fallback) return fallback;
    }
  }
  return null;
}

function normalizeCategory(category: string | null): string | null {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  return ["music", "food", "fitness", "social", "arts"].includes(c) ? c : null;
}

function deriveEventMetadata(event: {
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
}): {
  priceTier: "free" | "budget" | "mid" | "premium" | "unknown";
  alcoholPolicy: "alcoholic" | "non_alcoholic" | "mixed" | "unknown";
  isSports: boolean;
  subcategories: string[];
} {
  const tags = event.tags.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const text = `${event.title} ${event.description ?? ""} ${event.category ?? ""} ${tags.join(" ")}`.toLowerCase();

  let priceTier: "free" | "budget" | "mid" | "premium" | "unknown" = "unknown";
  if (/\bfree\b|no cost|entry free|complimentary/.test(text)) {
    priceTier = "free";
  } else if (/\$\s?\d{1,2}\b|under\s?\$?25|cheap|budget/.test(text)) {
    priceTier = "budget";
  } else if (/\$\s?(?:[3-9]\d|1\d{2})\b|premium|vip|exclusive/.test(text)) {
    priceTier = "premium";
  } else if (/\$\s?\d+/.test(text) || /ticket|bookings|admission/.test(text)) {
    priceTier = "mid";
  }

  let alcoholPolicy: "alcoholic" | "non_alcoholic" | "mixed" | "unknown" = "unknown";
  const hasAlcohol = /\balcohol|bar|beer|wine|cocktail|drinks?\b/.test(text);
  const hasNonAlcohol = /\bnon[- ]?alcoholic|alcohol[- ]?free|mocktail|family[- ]?friendly\b/.test(text);
  if (hasAlcohol && hasNonAlcohol) {
    alcoholPolicy = "mixed";
  } else if (hasNonAlcohol) {
    alcoholPolicy = "non_alcoholic";
  } else if (hasAlcohol) {
    alcoholPolicy = "alcoholic";
  }

  const isSports =
    /\bsport|sports|athletic|athletics|race|racing|run|running|football|soccer|basketball|cricket|tennis|gym\b/.test(
      text,
    ) || tags.some((tag) => ["sports", "athletics", "race day", "cricket"].includes(tag));

  const subcategories = Array.from(
    new Set(
      tags.filter(
        (tag) =>
          tag.length >= 3 &&
          !["event", "melbourne", "australia"].includes(tag) &&
          !["music", "food", "fitness", "social", "arts"].includes(tag),
      ),
    ),
  ).slice(0, 8);

  return { priceTier, alcoholPolicy, isSports, subcategories };
}

function normalizeEvent(
  parsed: ParsedEvent,
  sourceUrl: string,
  htmlImageUrl: string | null,
  geocode: GeocodeResult,
  dateTime: { dateDdMmYyyy: string; time24: string; epochMs: number; iso: string }
): NormalizedEvent {
  const title = parsed.event_name?.trim() || "Untitled Event";
  const sourceHost = new URL(sourceUrl).hostname;
  const date = dateTime.dateDdMmYyyy;
  const time = dateTime.time24;
  const metadata = deriveEventMetadata({
    title,
    description: parsed.description,
    category: parsed.category,
    tags: parsed.tags || [],
  });

  return {
    title,
    venue: parsed.venue,
    timeLabel: `${date} ${time}`.trim(),
    startAtIso: dateTime.iso,
    startEpochMs: dateTime.epochMs,
    description: parsed.description,
    sourceUrl,
    source: sourceHost,
    photoUrl: parsed.image_url || htmlImageUrl,
    location: geocode.text, // lat,long
    category: normalizeCategory(parsed.category),
    tags: parsed.tags || [],
    priceTier: metadata.priceTier,
    alcoholPolicy: metadata.alcoholPolicy,
    isSports: metadata.isSports,
    subcategories: metadata.subcategories,
    rawLocation: parsed.location!.trim(),
    date,
    time,
  };
}

function toSupabaseRow(event: NormalizedEvent): SupabaseEventRow {
  return {
    title: event.title,
    venue: event.venue,
    time_label: event.timeLabel,
    start_at: event.startAtIso,
    description: event.description,
    source_url: event.sourceUrl,
    source: event.source,
    photo_url: event.photoUrl,
    location: event.location, // lat,long
    category: event.category,
    tags: event.tags,
    price_tier: event.priceTier,
    alcohol_policy: event.alcoholPolicy,
    is_sports: event.isSports,
    subcategories: event.subcategories,
    spontaneity_score: null,
    crowd_label: null,
  };
}

async function eventAlreadyExists(sourceUrl: string, env: ResolvedEnv): Promise<boolean> {
  const query = new URLSearchParams({
    select: "id",
    source_url: `eq.${sourceUrl}`,
    limit: "1",
  });
  const res = await fetch(`${env.supabaseUrl}/rest/v1/events?${query.toString()}`, {
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase exists-check failed ${res.status}: ${clip(text, 400)}`);
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  return Array.isArray(rows) && rows.length > 0;
}

async function insertEventRow(row: SupabaseEventRow, env: ResolvedEnv): Promise<boolean> {
  if (await eventAlreadyExists(row.source_url, env)) return false;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert failed ${res.status}: ${clip(text, 400)}`);
  }
  return true;
}

async function cleanupExpiredEvents(env: ResolvedEnv, progress: ProgressEntry[]): Promise<number> {
  const now = new Date().toISOString();
  pushProgress(progress, {
    stage: "events.cleanup",
    status: "info",
    message: `Deleting events older than ${now}`,
  });

  const deleteUrl = `${env.supabaseUrl}/rest/v1/events?start_at=lt.${encodeURIComponent(now)}`;
  const res = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Prefer: "return=representation",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("start_at")) {
      pushProgress(progress, {
        stage: "events.cleanup",
        status: "warn",
        message: "Skipping expired-events cleanup because start_at is not available in Supabase schema",
      });
      return 0;
    }
    throw new Error(`Supabase cleanup failed ${res.status}: ${clip(text, 400)}`);
  }

  const rows = (await res.json()) as unknown[];
  const count = Array.isArray(rows) ? rows.length : 0;
  pushProgress(progress, {
    stage: "events.cleanup",
    status: "ok",
    message: `Deleted ${count} expired event(s)`,
    meta: { deleted: count },
  });
  return count;
}

async function processEventPage(
  sourceUrl: string,
  eventUrl: string,
  html: string,
  env: ResolvedEnv,
  progress: ProgressEntry[]
): Promise<{ event: NormalizedEvent | null; invalid?: InvalidEventDebug; error?: string; inserted?: boolean }> {
  try {
    pushProgress(progress, { stage: "event.render_pdf", status: "info", sourceUrl, eventUrl, message: "Rendering event page to PDF" });
    const pdfBytes = await renderPdfViaCloudflare(eventUrl, env);

    pushProgress(progress, {
      stage: "event.parse_gemini",
      status: "info",
      sourceUrl,
      eventUrl,
      message: `Parsing PDF with Gemini (${pdfBytes.length} bytes)`,
      meta: { pdf_output_hint_dir: "/pdfs" },
    });
    const parsed = await parseEventPdfWithGemini(pdfBytes, eventUrl, env);

    pushProgress(progress, { stage: "event.extract_image", status: "info", sourceUrl, eventUrl, message: "Extracting best image URL from event HTML" });
    const htmlImage = extractBestImageUrl(html, eventUrl);

    pushProgress(progress, { stage: "event.validate", status: "info", sourceUrl, eventUrl, message: "Validating required fields from Gemini output" });
    if (!parsed.date || !parsed.time || !parsed.location) {
      return {
        event: null,
        invalid: {
          sourceUrl,
          eventUrl,
          reason: "missing_required_fields",
          locationRaw: parsed.location,
          parsed,
        },
        error: "Invalid event: missing required date/time/location",
      };
    }

    const dateTime = buildEventDateTime(parsed.date, parsed.time);
    if (!dateTime) {
      return {
        event: null,
        invalid: {
          sourceUrl,
          eventUrl,
          reason: "invalid_date_or_time",
          locationRaw: parsed.location,
          parsed,
        },
        error: `Invalid event: expected DD/MM/YYYY and parseable time, got date="${parsed.date}" time="${parsed.time}"`,
      };
    }

    pushProgress(progress, { stage: "event.geocode", status: "info", sourceUrl, eventUrl, message: `Geocoding location: ${clip(parsed.location, 110)}` });
    const geocode = await geocodeToLatLng(parsed.location);
    if (!geocode) {
      return {
        event: null,
        invalid: {
          sourceUrl,
          eventUrl,
          reason: "geocode_failed",
          locationRaw: parsed.location,
          parsed,
        },
        error: `Invalid event: geocoding failed for location "${clip(parsed.location, 120)}"`,
      };
    }

    const normalized = normalizeEvent(parsed, eventUrl, htmlImage, geocode, dateTime);
    pushProgress(progress, { stage: "event.validate", status: "ok", sourceUrl, eventUrl, message: "Event normalized and valid" });

    // IMPORTANT: insert each valid event immediately (not at the end).
    pushProgress(progress, { stage: "events.insert", status: "info", sourceUrl, eventUrl, message: "Inserting valid event into Supabase" });
    const inserted = await insertEventRow(toSupabaseRow(normalized), env);
    if (inserted) {
      pushProgress(progress, { stage: "events.insert", status: "ok", sourceUrl, eventUrl, message: "Inserted event row" });
    } else {
      pushProgress(progress, { stage: "events.insert", status: "warn", sourceUrl, eventUrl, message: "Skipped insert: event already exists" });
    }

    return { event: normalized, inserted };
  } catch (err) {
    return { event: null, error: String(err) };
  }
}

async function runPipeline(envInput: Env): Promise<PipelineResult> {
  const env = readEnv(envInput);
  const urls = getConfiguredUrls();
  const progress: ProgressEntry[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const invalidEvents: InvalidEventDebug[] = [];
  const events: NormalizedEvent[] = [];
  let insertedCount = 0;
  let cleanedExpiredCount = 0;

  pushProgress(progress, {
    stage: "init",
    status: "info",
    message: `Starting run with ${urls.length} source URL(s) from urls.json`,
  });
  cleanedExpiredCount = await cleanupExpiredEvents(env, progress);

  for (const sourceUrl of urls) {
    try {
      const candidates = await discoverEventCandidates(sourceUrl, progress);
      const pages = await collectEventPagesWithFallback(candidates, sourceUrl, progress);

      const pageResults = await mapWithConcurrency(
        pages,
        EVENT_PROCESS_CONCURRENCY,
        async (page) => processEventPage(sourceUrl, page.eventUrl, page.html, env, progress)
      );

      for (const r of pageResults) {
        if (r.event) {
          events.push(r.event);
          if (r.inserted) insertedCount += 1;
        } else if (r.invalid) {
          invalidEvents.push(r.invalid);
          warnings.push(`${sourceUrl} :: ${r.error || r.invalid.reason}`);
          pushProgress(progress, {
            stage: "error",
            status: "warn",
            sourceUrl,
            eventUrl: r.invalid.eventUrl,
            message: `${sourceUrl} :: ${r.error || r.invalid.reason}`,
          });
        } else if (r.error) {
          errors.push(`${sourceUrl} :: ${r.error}`);
          pushProgress(progress, { stage: "error", status: "error", sourceUrl, message: `${sourceUrl} :: ${r.error}` });
        }
      }
    } catch (err) {
      errors.push(`${sourceUrl} :: ${String(err)}`);
      pushProgress(progress, { stage: "error", status: "error", sourceUrl, message: `${sourceUrl} :: ${String(err)}` });
    }
  }

  pushProgress(progress, {
    stage: "done",
    status: "ok",
    message: "Pipeline completed",
    meta: {
      valid_events: events.length,
      invalid_events: invalidEvents.length,
      inserted: insertedCount,
      cleaned_expired: cleanedExpiredCount,
      errors: errors.length,
      warnings: warnings.length,
    },
  });

  return {
    ok: errors.length === 0,
    count: events.length,
    insertedCount,
    cleanedExpiredCount,
    events,
    invalidEvents,
    warning: invalidEvents.length > 0 ? `${invalidEvents.length} event(s) were rejected. See invalidEvents for details.` : null,
    warnings,
    progress,
    errors,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/manual") {
      try {
        const result = await runPipeline(env);
        return Response.json(result);
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    if (request.method === "GET") {
      return Response.json({ ok: true, message: "Worker running. Use /manual" });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const result = await runPipeline(env);
      console.log(
        `[scheduled] done count=${result.count} inserted=${result.insertedCount} cleaned=${result.cleanedExpiredCount} invalid=${result.invalidEvents.length} errors=${result.errors.length}`
      );
    } catch (err) {
      console.error("[scheduled] failed:", String(err));
    }
  },
};




