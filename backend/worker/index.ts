import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

type ResolvedEnv = {
  gemini: string;
  accountId: string;
  cfToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

type ProgressStage =
  | "init"
  | "source.fetch_listing"
  | "source.discover_links"
  | "source.select_event_pages"
  | "event.render_pdf"
  | "event.parse_gemini"
  | "event.extract_image"
  | "event.geocode"
  | "event.validate"
  | "events.insert"
  | "done"
  | "error";

type ProgressEntry = {
  ts: string;
  stage: ProgressStage;
  status: "info" | "ok" | "warn" | "error";
  message: string;
  sourceUrl?: string;
  eventUrl?: string;
  meta?: Record<string, unknown>;
};

type EventCandidate = {
  url: string;
  score: number;
  reason: string;
};

type EventPage = {
  url: string;
  html: string;
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

type GeocodeResult = {
  lat: number;
  lng: number;
  latLngText: string;
};

type NormalizedEvent = {
  title: string;
  venue: string | null;
  timeLabel: string;
  photoUrl: string | null;
  locationLatLng: string;
  category: string | null;
  tags: string[];
  description: string | null;
  sourceUrl: string;
  source: string;
  date: string;
  time: string;
  rawLocation: string;
};

type EventInsertRow = {
  title: string;
  venue: string | null;
  time_label: string;
  photo_url: string | null;
  location: string;
  category: string | null;
  spontaneity_score: number | null;
  crowd_label: "quiet" | "moderate" | "busy" | "packed" | null;
  tags: string[];
  description: string | null;
  source_url: string;
  source: string;
};

type PipelineResult = {
  events: NormalizedEvent[];
  invalidEvents: InvalidEventDebug[];
  insertedCount: number;
  progress: ProgressEntry[];
  errors: string[];
  warnings: string[];
};

type InvalidEventDebug = {
  sourceUrl: string;
  eventUrl: string;
  reason: string;
  locationRaw: string | null;
  parsed: ParsedEvent | null;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
const PDF_OUTPUT_HINT_DIR = "/pdfs";
const USER_AGENT = "Mozilla/5.0 (compatible; UniHackEventCrawler/2.0)";
const NOMINATIM_USER_AGENT = "UniHackEventCrawler/2.0 (contact: unihack-events@example.com)";
const MAX_CANDIDATES_PER_SOURCE = 100;
const MAX_EVENT_PAGES_PER_SOURCE = 3;
const ROBOTS_CONCURRENCY = 4;
const EVENT_PROCESS_CONCURRENCY = 2;
const CF_MAX_RETRIES = 5;
const CF_BASE_BACKOFF_MS = 1200;
const CF_MAX_BACKOFF_MS = 20000;
const MIN_NOMINATIM_GAP_MS = 1200;

const robotsCache = new Map<string, boolean>();
let nextNominatimAt = 0;

function clip(text: string, n = 260): string {
  return text.length <= n ? text : `${text.slice(0, n)}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function pushProgress(
  progress: ProgressEntry[],
  entry: Omit<ProgressEntry, "ts">
): void {
  const withTs = { ts: nowIso(), ...entry };
  progress.push(withTs);
  const label = `[progress] ${withTs.stage} ${withTs.status}`;
  const scoped = withTs.eventUrl || withTs.sourceUrl || "";
  console.log(label, scoped, withTs.message);
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
    .filter((u) => u.length > 0);
}

function readEnv(env: Env): ResolvedEnv {
  const resolved: ResolvedEnv = {
    gemini: (env.GEMINI_API_KEY || "").trim(),
    accountId: (env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    cfToken: (env.CLOUDFLARE_API_TOKEN || "").trim(),
    supabaseUrl: (env.SUPABASE_URL || "").trim(),
    supabaseServiceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };

  if (!resolved.gemini) throw new Error("Missing GEMINI_API_KEY");
  if (!resolved.accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!resolved.cfToken) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!resolved.supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!resolved.supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  console.log("[env] loaded", {
    gemini: "set",
    cloudflare_account_id: "set",
    cloudflare_api_token: "set",
    supabase_url: resolved.supabaseUrl ? "set" : "missing",
    supabase_service_role_key: "set",
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY ? "set" : "missing",
  });

  return resolved;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed fetch ${url} status=${res.status}`);
  return await res.text();
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isValidCandidateUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes("{{") || u.includes("}}")) return false;
  if (u.includes("%7b%7b") || u.includes("%7d%7d")) return false;
  return true;
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = (match[1] || "").trim();
    if (!href) continue;
    if (href.startsWith("#")) continue;
    if (href.toLowerCase().startsWith("javascript:")) continue;
    const full = normalizeUrl(baseUrl, href);
    if (!full) continue;
    if (!isValidCandidateUrl(full)) continue;
    links.add(full);
  }
  return Array.from(links);
}

function extractLinksFromSitemapXml(xml: string): string[] {
  const links = new Set<string>();
  const re = /<loc>(.*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const url = (match[1] || "").trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    if (!isValidCandidateUrl(url)) continue;
    links.add(url);
  }
  return Array.from(links);
}

function scoreEventLikeUrl(url: string, sourceHost: string): EventCandidate | null {
  const target = url.toLowerCase();
  let score = 0;
  const positives = [
    "event",
    "events",
    "whatson",
    "what-s-on",
    "whats-on",
    "calendar",
    "festival",
    "gig",
    "workshop",
    "seminar",
    "meetup",
    "ticket",
  ];
  const negatives = [
    "login",
    "signup",
    "register",
    "privacy",
    "terms",
    "contact",
    "about",
    "faq",
    "help",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "youtube.com",
  ];

  for (const p of positives) if (target.includes(p)) score += 2;
  for (const n of negatives) if (target.includes(n)) score -= 4;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === sourceHost) score += 2;
    if (parsed.pathname.split("/").filter(Boolean).length >= 2) score += 1;
  } catch {
    return null;
  }

  if (score <= 0) return null;
  return { url, score, reason: "url-heuristic" };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runOne()
  );
  await Promise.all(runners);
  return out;
}

async function isAllowedByRobots(pageUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(pageUrl);
    const cacheKey = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    const cached = robotsCache.get(cacheKey);
    if (typeof cached === "boolean") return cached;

    const robotsRes = await fetch(`${parsed.protocol}//${parsed.host}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!robotsRes.ok) {
      robotsCache.set(cacheKey, true);
      return true;
    }

    const body = (await robotsRes.text()).toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const disallowRules: string[] = [];
    let inGlobalRules = false;
    for (const lineRaw of body.split("\n")) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("user-agent:")) {
        inGlobalRules = (line.split(":")[1] || "").trim() === "*";
        continue;
      }
      if (inGlobalRules && line.startsWith("disallow:")) {
        const disallow = (line.split(":")[1] || "").trim();
        if (disallow) disallowRules.push(disallow);
      }
    }

    for (const rule of disallowRules) {
      if (rule === "/" || path.startsWith(rule)) {
        robotsCache.set(cacheKey, false);
        return false;
      }
    }
    robotsCache.set(cacheKey, true);
    return true;
  } catch {
    return true;
  }
}

async function discoverEventCandidates(
  sourceUrl: string,
  progress: ProgressEntry[]
): Promise<EventCandidate[]> {
  pushProgress(progress, {
    stage: "source.fetch_listing",
    status: "info",
    sourceUrl,
    message: "Fetching listing HTML",
  });
  const listingHtml = await fetchText(sourceUrl);

  pushProgress(progress, {
    stage: "source.discover_links",
    status: "info",
    sourceUrl,
    message: "Extracting and scoring candidate links",
  });

  const sourceHost = new URL(sourceUrl).hostname;
  const listingLinks = extractLinksFromHtml(listingHtml, sourceUrl);
  let combined = listingLinks.slice(0, MAX_CANDIDATES_PER_SOURCE);

  if (combined.length < Math.floor(MAX_CANDIDATES_PER_SOURCE * 0.75)) {
    try {
      const parsed = new URL(sourceUrl);
      const sitemapUrl = `${parsed.protocol}//${parsed.host}/sitemap.xml`;
      const sitemapXml = await fetchText(sitemapUrl);
      const sitemapLinks = extractLinksFromSitemapXml(sitemapXml);
      combined = Array.from(new Set([...combined, ...sitemapLinks])).slice(
        0,
        MAX_CANDIDATES_PER_SOURCE
      );
    } catch (err) {
      pushProgress(progress, {
        stage: "source.discover_links",
        status: "warn",
        sourceUrl,
        message: `Sitemap unavailable: ${clip(String(err))}`,
      });
    }
  }

  const scored = combined
    .map((url) => scoreEventLikeUrl(url, sourceHost))
    .filter((entry): entry is EventCandidate => Boolean(entry))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const allowed = await mapWithConcurrency(scored, ROBOTS_CONCURRENCY, async (candidate) =>
    isAllowedByRobots(candidate.url)
  );

  const filtered: EventCandidate[] = [];
  for (let i = 0; i < scored.length; i++) {
    if (allowed[i]) filtered.push(scored[i]);
  }

  pushProgress(progress, {
    stage: "source.select_event_pages",
    status: "ok",
    sourceUrl,
    message: `Discovered ${filtered.length} robots-allowed candidates`,
  });
  return filtered;
}

async function collectEventPagesWithFallback(
  candidates: EventCandidate[],
  targetCount: number,
  sourceUrl: string,
  progress: ProgressEntry[]
): Promise<EventPage[]> {
  const pages: EventPage[] = [];
  for (const candidate of candidates) {
    if (pages.length >= targetCount) break;
    try {
      const html = await fetchText(candidate.url);
      pages.push({ url: candidate.url, html });
      pushProgress(progress, {
        stage: "source.select_event_pages",
        status: "ok",
        sourceUrl,
        eventUrl: candidate.url,
        message: `Accepted event page ${pages.length}/${targetCount}`,
        meta: { score: candidate.score },
      });
    } catch (err) {
      pushProgress(progress, {
        stage: "source.select_event_pages",
        status: "warn",
        sourceUrl,
        eventUrl: candidate.url,
        message: `Event page HTML fetch failed; trying next candidate (${clip(String(err))})`,
      });
    }
  }
  return pages;
}

function getRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("Retry-After");
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(retryAfter);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(CF_BASE_BACKOFF_MS * 2 ** (attempt - 1), CF_MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * 350);
  return exp + jitter;
}

async function renderPdf(pageUrl: string, env: ResolvedEnv): Promise<Uint8Array> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.accountId}/browser-rendering/pdf`;
  let lastError = "";

  for (let attempt = 1; attempt <= CF_MAX_RETRIES; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes;
    }

    const body = await res.text();
    lastError = `Cloudflare PDF failed ${res.status}: ${clip(body, 600)}`;

    if (res.status !== 429 || attempt === CF_MAX_RETRIES) {
      throw new Error(lastError);
    }
    const waitMs = getRetryAfterMs(res.headers) ?? computeBackoffMs(attempt);
    await sleep(waitMs);
  }

  throw new Error(lastError || "Cloudflare PDF failed after retries");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  return tags.length > 0 ? tags : null;
}

async function parseWithGemini(
  pdfBytes: Uint8Array,
  sourceUrl: string,
  env: ResolvedEnv
): Promise<ParsedEvent> {
  const prompt =
    "Extract event details from this PDF. Return JSON only (no markdown) with keys: " +
    '{"event_name":string|null,"description":string|null,"date":string|null,"time":string|null,"location":string|null,"venue":string|null,"category":string|null,"tags":string[]|null,"image_url":string|null,"source_url":string}. ' +
    `Set source_url to "${sourceUrl}".`;

  const res = await fetch(`${GEMINI_URL}?key=${env.gemini}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "application/pdf",
                data: toBase64(pdfBytes),
              },
            },
          ],
        },
      ],
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini failed ${res.status}: ${clip(body, 800)}`);

  const parsedBody = JSON.parse(body);
  const modelText: string = parsedBody?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = modelText.trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error(`Gemini response did not contain parseable JSON: ${clip(raw, 400)}`);
    }
    obj = JSON.parse(raw.slice(start, end + 1));
  }

  return {
    event_name: safeString(obj.event_name),
    description: safeString(obj.description),
    date: safeString(obj.date),
    time: safeString(obj.time),
    location: safeString(obj.location),
    venue: safeString(obj.venue),
    category: safeString(obj.category),
    tags: normalizeTags(obj.tags),
    image_url: safeString(obj.image_url),
    source_url: sourceUrl,
  };
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string | null {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = re.exec(html);
  return match?.[1]?.trim() || null;
}

function extractImageFromJsonLd(html: string, pageUrl: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const image = (item as Record<string, unknown>)?.image;
        if (typeof image === "string") {
          const normalized = normalizeUrl(pageUrl, image);
          if (normalized) return normalized;
        }
        if (Array.isArray(image)) {
          for (const img of image) {
            if (typeof img !== "string") continue;
            const normalized = normalizeUrl(pageUrl, img);
            if (normalized) return normalized;
          }
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function extractBestImageUrl(html: string, pageUrl: string): string | null {
  const og = extractMetaContent(html, "property", "og:image");
  if (og) return normalizeUrl(pageUrl, og) || og;

  const twitter = extractMetaContent(html, "name", "twitter:image");
  if (twitter) return normalizeUrl(pageUrl, twitter) || twitter;

  const jsonLd = extractImageFromJsonLd(html, pageUrl);
  if (jsonLd) return jsonLd;

  const imgMatch = /<img[^>]+src=["']([^"']+)["'][^>]*>/i.exec(html);
  if (!imgMatch?.[1]) return null;
  return normalizeUrl(pageUrl, imgMatch[1]) || null;
}

function extractDocumentTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "";
  return title.replace(/\s+/g, " ").trim() || null;
}

function parseLatLngText(input: string): GeocodeResult | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(input.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    latLngText: `${lat.toFixed(6)},${lng.toFixed(6)}`,
  };
}

function toValidatedGeocode(latRaw: unknown, lngRaw: unknown): GeocodeResult | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    latLngText: `${lat.toFixed(6)},${lng.toFixed(6)}`,
  };
}

async function geocodeViaNominatim(query: string): Promise<{
  status: "ok" | "none" | "forbidden";
  result: GeocodeResult | null;
}> {
  const endpoint =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&countrycodes=au&email=unihack-events@example.com&q=" +
    encodeURIComponent(query);
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": NOMINATIM_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-AU,en;q=0.9",
    },
  });
  if (res.status === 403) return { status: "forbidden", result: null };
  if (!res.ok) return { status: "none", result: null };

  const payload = (await res.json()) as unknown;
  const list = Array.isArray(payload)
    ? (payload as Array<{ lat?: string | number; lon?: string | number }>)
    : [];
  if (list.length === 0) return { status: "none", result: null };
  return {
    status: "ok",
    result: toValidatedGeocode(list[0].lat, list[0].lon),
  };
}

async function geocodeViaPhoton(query: string): Promise<GeocodeResult | null> {
  const endpoint = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const coords = payload?.features?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return toValidatedGeocode(coords[1], coords[0]);
}

async function geocodeToLatLng(locationText: string): Promise<GeocodeResult | null> {
  const alreadyCoords = parseLatLngText(locationText);
  if (alreadyCoords) return alreadyCoords;

  const cleaned = locationText
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  const simplified = cleaned
    .replace(/^the\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  const shortComma = simplified
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const queries = Array.from(new Set([cleaned, simplified, shortComma])).filter(Boolean);

  let sawNominatimForbidden = false;
  for (const query of queries) {
    const waitFor = nextNominatimAt - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    nextNominatimAt = Date.now() + MIN_NOMINATIM_GAP_MS;

    const lookup = await geocodeViaNominatim(query);
    if (lookup.status === "forbidden") {
      sawNominatimForbidden = true;
      continue;
    }
    if (lookup.result) return lookup.result;
  }

  if (sawNominatimForbidden) {
    for (const query of queries) {
      const waitFor = nextNominatimAt - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      nextNominatimAt = Date.now() + MIN_NOMINATIM_GAP_MS;
      const fallback = await geocodeViaPhoton(query);
      if (fallback) return fallback;
    }
  }

  return null;
}

function normalizeCategory(category: string | null): string | null {
  if (!category) return null;
  const value = category.trim().toLowerCase();
  if (!value) return null;
  if (["music", "food", "fitness", "social", "arts"].includes(value)) return value;
  return null;
}

function normalizeEvent(
  parsed: ParsedEvent,
  sourceUrl: string,
  fallbackTitle: string,
  imageFromHtml: string | null,
  geocode: GeocodeResult
): NormalizedEvent {
  const date = parsed.date!.trim();
  const time = parsed.time!.trim();
  const location = parsed.location!.trim();
  const title = parsed.event_name?.trim() || fallbackTitle || "Untitled Event";
  const sourceHost = new URL(sourceUrl).hostname;

  return {
    title,
    venue: parsed.venue,
    timeLabel: `${date} ${time}`.trim(),
    photoUrl: parsed.image_url || imageFromHtml,
    locationLatLng: geocode.latLngText,
    category: normalizeCategory(parsed.category),
    tags: parsed.tags || [],
    description: parsed.description,
    sourceUrl,
    source: sourceHost,
    date,
    time,
    rawLocation: location,
  };
}

function isValidParsedEvent(parsed: ParsedEvent): boolean {
  return Boolean(parsed.date && parsed.time && parsed.location);
}

function toSupabaseRow(event: NormalizedEvent): EventInsertRow {
  return {
    title: event.title,
    venue: event.venue,
    time_label: event.timeLabel,
    photo_url: event.photoUrl,
    location: event.locationLatLng,
    category: event.category,
    spontaneity_score: null,
    crowd_label: null,
    tags: event.tags,
    description: event.description,
    source_url: event.sourceUrl,
    source: event.source,
  };
}

async function insertEvents(
  rows: EventInsertRow[],
  env: ResolvedEnv
): Promise<{ insertedCount: number; errorText?: string }> {
  if (rows.length === 0) return { insertedCount: 0 };
  const res = await fetch(`${env.supabaseUrl}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    return { insertedCount: 0, errorText: `Supabase insert failed ${res.status}: ${clip(text, 800)}` };
  }

  const inserted = (await res.json()) as unknown[];
  return { insertedCount: Array.isArray(inserted) ? inserted.length : rows.length };
}

async function processEventPage(
  page: EventPage,
  sourceUrl: string,
  env: ResolvedEnv,
  progress: ProgressEntry[]
): Promise<{ event: NormalizedEvent | null; error?: string; invalid?: InvalidEventDebug }> {
  try {
    pushProgress(progress, {
      stage: "event.render_pdf",
      status: "info",
      sourceUrl,
      eventUrl: page.url,
      message: "Rendering event page to PDF",
    });
    const pdfBytes = await renderPdf(page.url, env);

    pushProgress(progress, {
      stage: "event.parse_gemini",
      status: "info",
      sourceUrl,
      eventUrl: page.url,
      message: `Parsing PDF with Gemini (${pdfBytes.length} bytes)`,
      meta: { pdf_output_hint_dir: PDF_OUTPUT_HINT_DIR },
    });
    const parsed = await parseWithGemini(pdfBytes, page.url, env);

    pushProgress(progress, {
      stage: "event.extract_image",
      status: "info",
      sourceUrl,
      eventUrl: page.url,
      message: "Extracting best image URL from event HTML",
    });
    const htmlImage = extractBestImageUrl(page.html, page.url);

    pushProgress(progress, {
      stage: "event.validate",
      status: "info",
      sourceUrl,
      eventUrl: page.url,
      message: "Validating required fields from Gemini output",
    });
    if (!isValidParsedEvent(parsed)) {
      return {
        event: null,
        error: "Invalid event: missing required date/time/location",
        invalid: {
          sourceUrl,
          eventUrl: page.url,
          reason: "missing_required_fields",
          locationRaw: parsed.location,
          parsed,
        },
      };
    }

    pushProgress(progress, {
      stage: "event.geocode",
      status: "info",
      sourceUrl,
      eventUrl: page.url,
      message: `Geocoding location: ${clip(parsed.location || "", 90)}`,
    });
    const geocode = await geocodeToLatLng(parsed.location!);
    if (!geocode) {
      return {
        event: null,
        error: `Invalid event: geocoding failed or returned invalid lat/lng (location="${clip(
          parsed.location || "",
          120
        )}")`,
        invalid: {
          sourceUrl,
          eventUrl: page.url,
          reason: "geocode_failed",
          locationRaw: parsed.location,
          parsed,
        },
      };
    }

    const fallbackTitle = extractDocumentTitle(page.html) || "Untitled Event";
    const normalized = normalizeEvent(parsed, page.url, fallbackTitle, htmlImage, geocode);

    pushProgress(progress, {
      stage: "event.validate",
      status: "ok",
      sourceUrl,
      eventUrl: page.url,
      message: "Event normalized and valid",
    });

    return { event: normalized };
  } catch (err) {
    return {
      event: null,
      error: String(err),
      invalid: {
        sourceUrl,
        eventUrl: page.url,
        reason: "processing_error",
        locationRaw: null,
        parsed: null,
      },
    };
  }
}

async function runPipeline(env: Env): Promise<PipelineResult> {
  const progress: ProgressEntry[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const invalidEvents: InvalidEventDebug[] = [];
  const resolved = readEnv(env);
  const urls = getConfiguredUrls();

  pushProgress(progress, {
    stage: "init",
    status: "info",
    message: `Starting run with ${urls.length} source URL(s) from urls.json`,
  });

  const validEvents: NormalizedEvent[] = [];
  for (const sourceUrl of urls) {
    try {
      const candidates = await discoverEventCandidates(sourceUrl, progress);
      const pages = await collectEventPagesWithFallback(
        candidates,
        MAX_EVENT_PAGES_PER_SOURCE,
        sourceUrl,
        progress
      );
      if (pages.length === 0) {
        pushProgress(progress, {
          stage: "source.select_event_pages",
          status: "warn",
          sourceUrl,
          message: "No usable event pages found for source",
        });
        continue;
      }

      const pageResults = await mapWithConcurrency(
        pages,
        EVENT_PROCESS_CONCURRENCY,
        async (page) => processEventPage(page, sourceUrl, resolved, progress)
      );
      for (const result of pageResults) {
        if (result.event) {
          validEvents.push(result.event);
        } else if (result.error) {
          const message = `${sourceUrl} :: ${result.error}`;
          warnings.push(message);
          if (result.invalid) invalidEvents.push(result.invalid);
          if (!result.invalid) {
            errors.push(message);
          }
          pushProgress(progress, {
            stage: "error",
            status: "warn",
            sourceUrl,
            message,
          });
        }
      }
    } catch (err) {
      const message = `${sourceUrl} :: ${String(err)}`;
      errors.push(message);
      pushProgress(progress, {
        stage: "error",
        status: "error",
        sourceUrl,
        message,
      });
    }
  }

  const rows = validEvents.map(toSupabaseRow);
  pushProgress(progress, {
    stage: "events.insert",
    status: "info",
    message: `Inserting ${rows.length} event row(s) into Supabase`,
  });

  const insertResult = await insertEvents(rows, resolved);
  if (insertResult.errorText) {
    errors.push(insertResult.errorText);
    pushProgress(progress, {
      stage: "events.insert",
      status: "error",
      message: insertResult.errorText,
    });
  } else {
    pushProgress(progress, {
      stage: "events.insert",
      status: "ok",
      message: `Inserted ${insertResult.insertedCount} row(s)`,
    });
  }

  pushProgress(progress, {
    stage: "done",
    status: "ok",
    message: "Pipeline completed",
    meta: {
      valid_events: validEvents.length,
      invalid_events: invalidEvents.length,
      inserted: insertResult.insertedCount,
      errors: errors.length,
    },
  });

  return {
    events: validEvents,
    invalidEvents,
    insertedCount: insertResult.insertedCount,
    progress,
    errors,
    warnings,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/manual") {
      try {
        const result = await runPipeline(env);
        return Response.json({
          ok: result.errors.length === 0,
          count: result.events.length,
          insertedCount: result.insertedCount,
          events: result.events,
          invalidEvents: result.invalidEvents,
          warning:
            result.invalidEvents.length > 0
              ? `${result.invalidEvents.length} event(s) were rejected. See invalidEvents for details.`
              : null,
          warnings: result.warnings,
          progress: result.progress,
          errors: result.errors,
        });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    if (request.method === "GET") {
      return Response.json({
        ok: true,
        message: "Worker running. Use GET /manual to run the pipeline.",
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const result = await runPipeline(env);
      console.log(
        `[scheduled] done count=${result.events.length} inserted=${result.insertedCount} errors=${result.errors.length}`
      );
    } catch (err) {
      console.error("[scheduled] failed", String(err));
    }
  },
};

