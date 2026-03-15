import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_PULISHABLE_KEY?: string;
}

type ResolvedEnv = {
  geminiKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
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
  location: string;
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
  location: string;
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
    | "event.parse_structured"
    | "event.generate_description"
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

type JsonLdEvent = Record<string, unknown>;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
const USER_AGENT = "Mozilla/5.0 (compatible; UniHackEventWorker/2.1)";
const OSM_USER_AGENT = "UniHackEventWorker/2.1 (contact: unihack-events@example.com)";
const MAX_EVENT_PAGES_PER_SOURCE = 3;
const EVENT_PROCESS_CONCURRENCY = 4;
const GEOCODE_MIN_GAP_MS = 1100;
const DEFAULT_EVENT_TIMEZONE = "Australia/Melbourne";
const GEOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const DESC_CACHE_TTL_SECONDS = 60 * 60 * 24 * 14;
const ALLOWED_CATEGORIES = ["music", "food", "fitness", "social", "arts"] as const;

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
    supabaseUrl: (env.SUPABASE_URL || "").trim(),
    supabaseServiceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
  if (!resolved.geminiKey) throw new Error("Missing GEMINI_API_KEY");
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
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" } });
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

function scoreEventLikeUrl(url: string, sourceHost: string): number {
  const u = url.toLowerCase();
  let score = 0;
  const pos = ["event", "events", "whatson", "whats-on", "calendar", "festival", "gig", "seminar", "workshop", "meetup", "ticket"];
  const neg = ["login", "signup", "privacy", "terms", "contact", "about", "faq"];
  for (const p of pos) if (u.includes(p)) score += 2;
  for (const n of neg) if (u.includes(n)) score -= 3;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === sourceHost) score += 2;
  } catch {
    score -= 4;
  }
  return score;
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
  return null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseJsonSafe(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function flattenJsonLdEvents(node: unknown): JsonLdEvent[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLdEvents);
  if (typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) return flattenJsonLdEvents(obj["@graph"]);
  const typeRaw = obj["@type"];
  const types = Array.isArray(typeRaw) ? typeRaw : [typeRaw];
  const hasEventType = types.some((t) => typeof t === "string" && t.toLowerCase() === "event");
  return hasEventType ? [obj] : [];
}

function extractJsonLdEvents(html: string): JsonLdEvent[] {
  const out: JsonLdEvent[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    const parsed = parseJsonSafe(raw);
    out.push(...flattenJsonLdEvents(parsed));
  }
  return out;
}

function extractDatePart(dateTimeIso: string): string | null {
  const dt = new Date(dateTimeIso);
  if (Number.isNaN(dt.getTime())) return null;
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = String(dt.getFullYear());
  return `${d}/${m}/${y}`;
}

function extractTimePart(dateTimeIso: string): string | null {
  const dt = new Date(dateTimeIso);
  if (Number.isNaN(dt.getTime())) return null;
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parsedFromJsonLd(jsonLd: JsonLdEvent, sourceUrl: string): ParsedEvent | null {
  const startDate = asStringOrNull(jsonLd.startDate);
  const locationObj = (jsonLd.location && typeof jsonLd.location === "object") ? (jsonLd.location as Record<string, unknown>) : null;
  const addressObj = (locationObj?.address && typeof locationObj.address === "object") ? (locationObj.address as Record<string, unknown>) : null;
  const addressText =
    asStringOrNull(locationObj?.name) ||
    asStringOrNull(addressObj?.streetAddress) ||
    asStringOrNull(addressObj?.addressLocality) ||
    asStringOrNull(addressObj?.name) ||
    asStringOrNull(jsonLd.location);
  if (!startDate || !addressText) return null;

  return {
    event_name: asStringOrNull(jsonLd.name),
    description: asStringOrNull(jsonLd.description),
    date: extractDatePart(startDate),
    time: extractTimePart(startDate),
    location: addressText,
    venue: asStringOrNull(locationObj?.name),
    category: asStringOrNull(jsonLd.eventAttendanceMode) || asStringOrNull(jsonLd.about),
    tags: Array.isArray(jsonLd.keywords)
      ? (jsonLd.keywords as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
      : typeof jsonLd.keywords === "string"
        ? (jsonLd.keywords as string).split(",").map((t) => t.trim()).filter(Boolean)
        : null,
    image_url: Array.isArray(jsonLd.image)
      ? asStringOrNull((jsonLd.image as unknown[])[0])
      : asStringOrNull(jsonLd.image),
    source_url: sourceUrl,
  };
}

function sanitizeDescription(input: string): string | null {
  let out = input
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!out) return null;
  const words = out.split(/\s+/);
  if (words.length > 50) out = words.slice(0, 50).join(" ");
  return out.trim();
}

function normalizeCategory(category: string | null): string | null {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  return ALLOWED_CATEGORIES.includes(c as (typeof ALLOWED_CATEGORIES)[number]) ? c : null;
}

function inferCategoryFallback(parsed: ParsedEvent): (typeof ALLOWED_CATEGORIES)[number] {
  const text = `${parsed.event_name ?? ""} ${parsed.description ?? ""} ${parsed.category ?? ""} ${(parsed.tags ?? []).join(" ")}`.toLowerCase();
  if (/\bmusic|dj|band|concert|gig|live\b/.test(text)) return "music";
  if (/\bfood|drink|dining|restaurant|market|tasting\b/.test(text)) return "food";
  if (/\bfitness|yoga|gym|run|running|workout|wellness\b/.test(text)) return "fitness";
  if (/\bart|gallery|exhibition|theatre|theater|comedy|film|cinema\b/.test(text)) return "arts";
  return "social";
}

async function enrichMissingFieldsWithGemini(event: ParsedEvent, env: ResolvedEnv): Promise<{ description: string | null; category: string | null }> {
  const cacheKey = `enrich:${(event.source_url || "").trim().toLowerCase()}`;
  const cached = await caches.default.match(new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`));
  if (cached) {
    const payload = (await cached.json()) as { description?: string | null; category?: string | null };
    return {
      description: payload.description ?? null,
      category: payload.category ?? null,
    };
  }

  const prompt =
    "You are writing compact event-card copy.\n" +
    "Return STRICT JSON only with keys: description, category.\n" +
    "Rules:\n" +
    "1) description: max 50 words, 1-2 sentences, clear and readable.\n" +
    "2) description: STRICTLY NO EMOJIS, no URLs, no markdown, no hashtags.\n" +
    "3) description: factual only from provided fields.\n" +
    "4) category: MUST be one of exactly [music, food, fitness, social, arts].\n" +
    "5) If unsure, choose the closest valid category (default social).\n" +
    "6) Never return null for category.\n\n" +
    `DATA: ${JSON.stringify({
      name: event.event_name,
      description: event.description,
      date: event.date,
      time: event.time,
      location: event.location,
      venue: event.venue,
      category: event.category,
      tags: event.tags,
      source_url: event.source_url,
    })}`;

  const res = await fetch(`${GEMINI_URL}?key=${env.geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.15,
        topP: 0.9,
        maxOutputTokens: 160,
        responseMimeType: "application/json",
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  const raw = await res.text();
  if (!res.ok) return { description: null, category: null };

  let modelText = "";
  try {
    const data = JSON.parse(raw);
    modelText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch {
    return { description: null, category: null };
  }

  let description: string | null = null;
  let category: string | null = null;

  try {
    const parsed = JSON.parse(modelText);
    description = asStringOrNull(parsed?.description);
    category = asStringOrNull(parsed?.category);
  } catch {
    return { description: null, category: null };
  }

  const safeDescription = description ? sanitizeDescription(description) : null;
  const safeCategory = normalizeCategory(category);

  const result = { description: safeDescription, category: safeCategory };
  const response = new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${DESC_CACHE_TTL_SECONDS}` },
  });
  await caches.default.put(new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`), response);

  return result;
}

async function generateDescriptionWithGemini(event: ParsedEvent, env: ResolvedEnv): Promise<string | null> {
  const enriched = await enrichMissingFieldsWithGemini(event, env);
  return enriched.description;
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
  const asIfUtc = Date.UTC(values.year ?? 0, (values.month ?? 1) - 1, values.day ?? 1, values.hour ?? 0, values.minute ?? 0, values.second ?? 0);
  return asIfUtc - utcMs;
}

function zonedDateTimeToEpochMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetFirst = offsetForTimeZone(utcGuess, timeZone);
  let resolved = utcGuess - offsetFirst;
  const offsetSecond = offsetForTimeZone(resolved, timeZone);
  if (offsetSecond !== offsetFirst) resolved = utcGuess - offsetSecond;
  return resolved;
}

function buildEventDateTime(dateText: string, timeText: string): { dateDdMmYyyy: string; time24: string; epochMs: number; iso: string } | null {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText.trim());
  if (!dateMatch || !timeMatch) return null;
  const dd = Number(dateMatch[1]);
  const mm = Number(dateMatch[2]);
  const yyyy = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const min = Number(timeMatch[2]);
  const epochMs = zonedDateTimeToEpochMs(yyyy, mm, dd, hh, min, DEFAULT_EVENT_TIMEZONE);
  return { dateDdMmYyyy: dateText.trim(), time24: timeText.trim(), epochMs, iso: new Date(epochMs).toISOString() };
}

function deriveEventMetadata(event: { title: string; description: string | null; category: string | null; tags: string[] }) {
  const tags = event.tags.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const text = `${event.title} ${event.description ?? ""} ${event.category ?? ""} ${tags.join(" ")}`.toLowerCase();
  let priceTier: "free" | "budget" | "mid" | "premium" | "unknown" = "unknown";
  if (/\bfree\b|no cost|entry free|complimentary/.test(text)) priceTier = "free";
  else if (/\$\s?\d{1,2}\b|under\s?\$?25|cheap|budget/.test(text)) priceTier = "budget";
  else if (/\$\s?(?:[3-9]\d|1\d{2})\b|premium|vip|exclusive/.test(text)) priceTier = "premium";
  else if (/\$\s?\d+/.test(text) || /ticket|bookings|admission/.test(text)) priceTier = "mid";
  let alcoholPolicy: "alcoholic" | "non_alcoholic" | "mixed" | "unknown" = "unknown";
  const hasAlcohol = /\balcohol|bar|beer|wine|cocktail|drinks?\b/.test(text);
  const hasNonAlcohol = /\bnon[- ]?alcoholic|alcohol[- ]?free|mocktail|family[- ]?friendly\b/.test(text);
  if (hasAlcohol && hasNonAlcohol) alcoholPolicy = "mixed";
  else if (hasNonAlcohol) alcoholPolicy = "non_alcoholic";
  else if (hasAlcohol) alcoholPolicy = "alcoholic";
  const isSports = /\bsport|sports|athletic|race|running|football|soccer|basketball|cricket|tennis|gym\b/.test(text);
  const subcategories = Array.from(new Set(tags.filter((tag) => tag.length >= 3 && !["event", "melbourne", "australia"].includes(tag)))).slice(0, 8);
  return { priceTier, alcoholPolicy, isSports, subcategories };
}

function normalizeEvent(parsed: ParsedEvent, sourceUrl: string, htmlImageUrl: string | null, geocode: GeocodeResult, dateTime: { dateDdMmYyyy: string; time24: string; epochMs: number; iso: string }): NormalizedEvent {
  const title = parsed.event_name?.trim() || "Untitled Event";
  const sourceHost = new URL(sourceUrl).hostname;
  const safeCategory = normalizeCategory(parsed.category) || inferCategoryFallback(parsed);
  const metadata = deriveEventMetadata({ title, description: parsed.description, category: safeCategory, tags: parsed.tags || [] });

  return {
    title,
    venue: parsed.venue,
    timeLabel: `${dateTime.dateDdMmYyyy} ${dateTime.time24}`.trim(),
    startAtIso: dateTime.iso,
    startEpochMs: dateTime.epochMs,
    description: parsed.description,
    sourceUrl,
    source: sourceHost,
    photoUrl: parsed.image_url || htmlImageUrl,
    location: geocode.text,
    category: safeCategory,
    tags: parsed.tags || [],
    priceTier: metadata.priceTier,
    alcoholPolicy: metadata.alcoholPolicy,
    isSports: metadata.isSports,
    subcategories: metadata.subcategories,
    rawLocation: parsed.location!.trim(),
    date: dateTime.dateDdMmYyyy,
    time: dateTime.time24,
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
    location: event.location,
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
  const query = new URLSearchParams({ select: "id", source_url: `eq.${sourceUrl}`, limit: "1" });
  const res = await fetch(`${env.supabaseUrl}/rest/v1/events?${query.toString()}`, {
    headers: { apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` },
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
  pushProgress(progress, { stage: "events.cleanup", status: "info", message: `Deleting events older than ${now}` });
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
      pushProgress(progress, { stage: "events.cleanup", status: "warn", message: "Skipping expired-events cleanup because start_at is not available" });
      return 0;
    }
    throw new Error(`Supabase cleanup failed ${res.status}: ${clip(text, 400)}`);
  }
  const rows = (await res.json()) as unknown[];
  const count = Array.isArray(rows) ? rows.length : 0;
  pushProgress(progress, { stage: "events.cleanup", status: "ok", message: `Deleted ${count} expired event(s)`, meta: { deleted: count } });
  return count;
}

async function geocodeWithCache(locationText: string): Promise<GeocodeResult | null> {
  const cacheKey = `geocode:${locationText.trim().toLowerCase()}`;
  const cacheReq = new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`);
  const cached = await caches.default.match(cacheReq);
  if (cached) {
    const payload = (await cached.json()) as GeocodeResult;
    if (payload?.text) return payload;
  }
  const value = await geocodeToLatLng(locationText);
  if (!value) return null;
  const response = new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${GEOCODE_CACHE_TTL_SECONDS}` },
  });
  await caches.default.put(cacheReq, response);
  return value;
}

async function processSourceUrl(
  sourceUrl: string,
  env: ResolvedEnv,
  progress: ProgressEntry[]
): Promise<{ events: NormalizedEvent[]; inserted: number; invalid: InvalidEventDebug[]; warnings: string[]; errors: string[] }> {
  const events: NormalizedEvent[] = [];
  const invalid: InvalidEventDebug[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  pushProgress(progress, { stage: "source.fetch_listing", status: "info", sourceUrl, message: "Fetching listing page" });
  const html = await fetchText(sourceUrl);

  pushProgress(progress, { stage: "source.discover_links", status: "info", sourceUrl, message: "Extracting candidate event links" });
  const links = extractLinksFromHtml(html, sourceUrl)
    .sort((a, b) => scoreEventLikeUrl(b, new URL(sourceUrl).hostname) - scoreEventLikeUrl(a, new URL(sourceUrl).hostname))
    .slice(0, MAX_EVENT_PAGES_PER_SOURCE);

  const pages = [sourceUrl, ...links];
  let inserted = 0;

  await mapWithConcurrency(pages, EVENT_PROCESS_CONCURRENCY, async (eventUrl) => {
    try {
      const pageHtml = eventUrl === sourceUrl ? html : await fetchText(eventUrl);
      pushProgress(progress, { stage: "event.parse_structured", status: "info", sourceUrl, eventUrl, message: "Parsing JSON-LD Event data" });
      const jsonLdEvents = extractJsonLdEvents(pageHtml);
      if (!jsonLdEvents.length) return;

      for (const jsonLd of jsonLdEvents) {
        const parsed = parsedFromJsonLd(jsonLd, eventUrl);
        if (!parsed || !parsed.date || !parsed.time || !parsed.location) {
          invalid.push({ sourceUrl, eventUrl, reason: "missing_required_fields", locationRaw: parsed?.location ?? null, parsed: parsed ?? null });
          warnings.push(`${sourceUrl} :: missing_required_fields`);
          continue;
        }

        if (!parsed.description || !normalizeCategory(parsed.category)) {
          pushProgress(progress, { stage: "event.generate_description", status: "info", sourceUrl, eventUrl, message: "Generating missing description/category with Gemini" });
          const enriched = await enrichMissingFieldsWithGemini(parsed, env);

          if (!parsed.description && enriched.description) parsed.description = enriched.description;
          parsed.description = parsed.description ? sanitizeDescription(parsed.description) : parsed.description;

          if (!normalizeCategory(parsed.category) && enriched.category) parsed.category = enriched.category;
          if (!normalizeCategory(parsed.category)) parsed.category = inferCategoryFallback(parsed);

          pushProgress(progress, {
            stage: "event.generate_description",
            status: "ok",
            sourceUrl,
            eventUrl,
            message: "Applied Gemini enrichment",
          });
        }

        const dateTime = buildEventDateTime(parsed.date, parsed.time);
        if (!dateTime) {
          invalid.push({ sourceUrl, eventUrl, reason: "invalid_date_or_time", locationRaw: parsed.location, parsed });
          warnings.push(`${sourceUrl} :: invalid_date_or_time`);
          continue;
        }

        pushProgress(progress, { stage: "event.geocode", status: "info", sourceUrl, eventUrl, message: `Geocoding location: ${clip(parsed.location, 100)}` });
        const geocode = await geocodeWithCache(parsed.location);
        if (!geocode) {
          invalid.push({ sourceUrl, eventUrl, reason: "geocode_failed", locationRaw: parsed.location, parsed });
          warnings.push(`${sourceUrl} :: geocode_failed`);
          continue;
        }

        const normalized = normalizeEvent(parsed, eventUrl, extractBestImageUrl(pageHtml, eventUrl), geocode, dateTime);
        events.push(normalized);

        pushProgress(progress, { stage: "events.insert", status: "info", sourceUrl, eventUrl, message: "Inserting event immediately" });
        const didInsert = await insertEventRow(toSupabaseRow(normalized), env);
        if (didInsert) {
          inserted += 1;
          pushProgress(progress, { stage: "events.insert", status: "ok", sourceUrl, eventUrl, message: "Inserted event row" });
        } else {
          pushProgress(progress, { stage: "events.insert", status: "warn", sourceUrl, eventUrl, message: "Skipped insert: already exists" });
        }
      }
    } catch (err) {
      const msg = `${sourceUrl} :: ${String(err)}`;
      errors.push(msg);
      pushProgress(progress, { stage: "error", status: "error", sourceUrl, eventUrl, message: msg });
    }
  });

  return { events, inserted, invalid, warnings, errors };
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

  pushProgress(progress, { stage: "init", status: "info", message: `Starting structured pipeline with ${urls.length} source URL(s)` });
  cleanedExpiredCount = await cleanupExpiredEvents(env, progress);

  for (const sourceUrl of urls) {
    try {
      const result = await processSourceUrl(sourceUrl, env, progress);
      events.push(...result.events);
      invalidEvents.push(...result.invalid);
      warnings.push(...result.warnings);
      errors.push(...result.errors);
      insertedCount += result.inserted;
    } catch (err) {
      const msg = `${sourceUrl} :: ${String(err)}`;
      errors.push(msg);
      pushProgress(progress, { stage: "error", status: "error", sourceUrl, message: msg });
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
    if (request.method === "GET") return Response.json({ ok: true, message: "Worker running. Use /manual" });
    return new Response("Method Not Allowed", { status: 405 });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const result = await runPipeline(env);
      console.log(`[scheduled] done count=${result.count} inserted=${result.insertedCount} cleaned=${result.cleanedExpiredCount} invalid=${result.invalidEvents.length} errors=${result.errors.length}`);
    } catch (err) {
      console.error("[scheduled] failed:", String(err));
    }
  },
};

