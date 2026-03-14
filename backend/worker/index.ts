import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_URL: string;
}

type EventCandidate = {
  url: string;
  score: number;
  reason: string;
};

type ParsedEvent = {
  event_name: string | null;
  description: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  source_url: string;
};

type ResolvedEnv = {
  gemini: string;
  accountId: string;
  cfToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

const MAX_EVENT_PAGES_PER_SOURCE = 3;
const MAX_CANDIDATES_PER_SOURCE = 80;
const USER_AGENT = "Mozilla/5.0 (compatible; EventCrawler/1.0)";

// Rate-limit handling
const CF_MAX_RETRIES = 5;
const CF_BASE_BACKOFF_MS = 1200;
const CF_MAX_BACKOFF_MS = 20000;

// Concurrency controls
const ROBOTS_CONCURRENCY = 4;
const EVENT_PROCESS_CONCURRENCY = 2;

// Cache robots result per host+path to avoid repeated fetch/parse
const robotsCache = new Map<string, boolean>();

function getConfiguredUrls(): string[] {
  const raw = Array.isArray((urlsConfig as { urls?: unknown[] })?.urls)
    ? (urlsConfig as { urls: unknown[] }).urls
    : Array.isArray(urlsConfig)
      ? (urlsConfig as unknown[])
      : [];

  const urls = raw
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  console.log("[getConfiguredUrls] Loaded URLs:", urls.length);
  return urls;
}

function clip(s: string, n = 300): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("Retry-After");
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;

  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(CF_BASE_BACKOFF_MS * 2 ** (attempt - 1), CF_MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * 350);
  return exp + jitter;
}

function readEnv(env: Env): ResolvedEnv {
  const gemini = (env.GEMINI_API_KEY || "").trim();
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const cfToken = (env.CLOUDFLARE_API_TOKEN || "").trim();
  const supabaseUrl = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supabaseServiceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  console.log("[readEnv] Env status", {
    gemini_api_key: gemini ? "set" : "missing",
    cloudflare_account_id: accountId ? "set" : "missing",
    cloudflare_api_token: cfToken ? "set" : "missing",
    supabase_url: supabaseUrl ? "set" : "missing",
    supabase_service_role_key: supabaseServiceRoleKey ? "set" : "missing",
  });

  return { gemini, accountId, cfToken, supabaseUrl, supabaseServiceRoleKey };
}

function validateEnvResolved(resolved: ResolvedEnv): void {
  if (!resolved.gemini) throw new Error("Missing GEMINI_API_KEY");
  if (!resolved.accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!resolved.cfToken) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!resolved.supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!resolved.supabaseServiceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
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

function isValidCandidateUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (s.includes("%7b%7b") || s.includes("%7d%7d")) return false;
  if (s.includes("{{") || s.includes("}}")) return false;
  return true;
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const href = (m[1] || "").trim();
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    const full = normalizeUrl(baseUrl, href);
    if (full && isValidCandidateUrl(full)) links.add(full);
  }

  return Array.from(links);
}

function extractLinksFromSitemapXml(xml: string): string[] {
  const links = new Set<string>();
  const re = /<loc>(.*?)<\/loc>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const u = (m[1] || "").trim();
    if ((u.startsWith("http://") || u.startsWith("https://")) && isValidCandidateUrl(u)) {
      links.add(u);
    }
  }

  return Array.from(links);
}

function scoreEventLikeUrl(url: string, sourceHost: string): EventCandidate | null {
  let score = 0;
  const u = url.toLowerCase();

  const positive = [
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

  const negative = [
    "login",
    "signup",
    "register",
    "privacy",
    "terms",
    "contact",
    "about",
    "faq",
    "help",
    "account",
    "cart",
    "checkout",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "youtube.com",
  ];

  for (const p of positive) if (u.includes(p)) score += 2;
  for (const n of negative) if (u.includes(n)) score -= 3;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === sourceHost) score += 2;
    if (parsed.pathname.split("/").filter(Boolean).length >= 2) score += 1;
  } catch {
    return null;
  }

  if (score <= 0) return null;
  return { url, score, reason: "keyword/url-heuristic" };
}

async function isAllowedByRobots(pageUrl: string): Promise<boolean> {
  try {
    const u = new URL(pageUrl);
    const cacheKey = `${u.protocol}//${u.host}${u.pathname}`;
    const cached = robotsCache.get(cacheKey);
    if (typeof cached === "boolean") return cached;

    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const robots = await fetch(robotsUrl, { headers: { "User-Agent": USER_AGENT } });

    if (!robots.ok) {
      robotsCache.set(cacheKey, true);
      return true;
    }

    const txt = (await robots.text()).toLowerCase();
    const path = u.pathname.toLowerCase();

    let inStar = false;
    const disallow: string[] = [];
    for (const lineRaw of txt.split("\n")) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("user-agent:")) {
        const ua = line.split(":")[1]?.trim() || "";
        inStar = ua === "*";
        continue;
      }
      if (inStar && line.startsWith("disallow:")) {
        const rule = (line.split(":")[1] || "").trim();
        if (rule) disallow.push(rule);
      }
    }

    for (const rule of disallow) {
      if (rule === "/" || path.startsWith(rule.toLowerCase())) {
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function run() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => run()
  );
  await Promise.all(runners);
  return results;
}

async function discoverEventPages(sourceUrl: string): Promise<string[]> {
  console.log("[discoverEventPages] source:", sourceUrl);

  const sourceHost = new URL(sourceUrl).hostname;
  const listingHtml = await fetchText(sourceUrl);
  const listingLinks = extractLinksFromHtml(listingHtml, sourceUrl);
  const listingCandidates = Array.from(new Set(listingLinks))
    .filter(isValidCandidateUrl)
    .slice(0, MAX_CANDIDATES_PER_SOURCE);

  let combined = listingCandidates;

  if (combined.length < Math.floor(MAX_CANDIDATES_PER_SOURCE * 0.75)) {
    try {
      const u = new URL(sourceUrl);
      const sitemap = `${u.protocol}//${u.host}/sitemap.xml`;
      const sitemapXml = await fetchText(sitemap);
      const sitemapLinks = extractLinksFromSitemapXml(sitemapXml);
      combined = Array.from(new Set([...combined, ...sitemapLinks]))
        .filter(isValidCandidateUrl)
        .slice(0, MAX_CANDIDATES_PER_SOURCE);
    } catch (err) {
      console.log("[discoverEventPages] sitemap unavailable:", String(err));
    }
  }

  const scored = combined
    .map((u) => scoreEventLikeUrl(u, sourceHost))
    .filter((x): x is EventCandidate => Boolean(x))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const allowedFlags = await mapWithConcurrency(
    scored,
    ROBOTS_CONCURRENCY,
    async (c) => isAllowedByRobots(c.url)
  );

  const picked: string[] = [];
  for (let i = 0; i < scored.length; i++) {
    if (picked.length >= MAX_EVENT_PAGES_PER_SOURCE) break;
    if (!allowedFlags[i]) {
      console.log("[discoverEventPages] robots denied:", scored[i].url);
      continue;
    }
    picked.push(scored[i].url);
  }

  console.log("[discoverEventPages] selected:", picked);
  return picked;
}

async function renderPdfViaCloudflare(pageUrl: string, resolved: ResolvedEnv): Promise<Uint8Array> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${resolved.accountId}/browser-rendering/pdf`;
  console.log("[renderPdfViaCloudflare] endpoint:", endpoint);

  let lastErr = "";
  for (let attempt = 1; attempt <= CF_MAX_RETRIES; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.cfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: pageUrl }),
    });

    if (res.ok) {
      const ab = await res.arrayBuffer();
      return new Uint8Array(ab);
    }

    const body = await res.text();
    lastErr = `Cloudflare PDF failed ${res.status}: ${clip(body, 800)}`;
    if (res.status !== 429 || attempt === CF_MAX_RETRIES) {
      throw new Error(lastErr);
    }

    const retryAfterMs = getRetryAfterMs(res.headers);
    const backoffMs = retryAfterMs ?? computeBackoffMs(attempt);
    console.warn(
      `[renderPdfViaCloudflare] rate limited (429). attempt=${attempt}/${CF_MAX_RETRIES} waiting=${backoffMs}ms url=${pageUrl}`
    );
    await sleep(backoffMs);
  }

  throw new Error(lastErr || "Cloudflare PDF failed after retries");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

async function parseEventPdfWithGemini(
  pdfBytes: Uint8Array,
  sourceUrl: string,
  resolved: ResolvedEnv
): Promise<ParsedEvent> {
  const inlineData = toBase64(pdfBytes);
  const prompt =
    'Extract event details from this PDF and return STRICT one-line JSON only with keys: ' +
    '{"event_name":string|null,"description":string|null,"date":string|null,"time":string|null,"location":string|null,"source_url":string}. ' +
    `Set source_url="${sourceUrl}". No markdown.`;

  const res = await fetch(`${GEMINI_URL}?key=${resolved.gemini}`, {
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
                data: inlineData,
              },
            },
          ],
        },
      ],
    }),
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`Gemini failed ${res.status}: ${clip(txt, 800)}`);

  const data = JSON.parse(txt);
  const modelText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = modelText.trim();

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) obj = JSON.parse(raw.slice(s, e + 1));
    else throw new Error(`Could not parse Gemini JSON object: ${clip(raw, 500)}`);
  }

  return {
    event_name: typeof obj?.event_name === "string" ? obj.event_name : null,
    description: typeof obj?.description === "string" ? obj.description : null,
    date: typeof obj?.date === "string" ? obj.date : null,
    time: typeof obj?.time === "string" ? obj.time : null,
    location: typeof obj?.location === "string" ? obj.location : null,
    source_url: sourceUrl,
  };
}

async function insertEventToSupabase(event: ParsedEvent, env: ResolvedEnv): Promise<void> {
  const row = {
    event_name: event.event_name,
    description: event.description,
    date: event.date,
    time: event.time,
    location: event.location,
    source_url: event.source_url,
  };

  const res = await fetch(`${env.supabaseUrl}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase insert failed ${res.status}: ${clip(errText, 800)}`);
  }
}

async function processEventUrl(eventUrl: string, resolved: ResolvedEnv): Promise<ParsedEvent | null> {
  try {
    console.log("[processAllUrls] rendering PDF:", eventUrl);
    const pdf = await renderPdfViaCloudflare(eventUrl, resolved);
    console.log("[processAllUrls] pdf bytes:", pdf.length, "url:", eventUrl);

    const parsed = await parseEventPdfWithGemini(pdf, eventUrl, resolved);
    console.log("[processAllUrls] parsed event:", parsed);

    // Insert immediately after parse
    await insertEventToSupabase(parsed, resolved);
    console.log("[processAllUrls] inserted into supabase:", eventUrl);

    return parsed;
  } catch (err) {
    console.error("[processAllUrls] failed event url:", eventUrl, String(err));
    return null;
  }
}

async function processAllUrls(env: Env): Promise<ParsedEvent[]> {
  const resolved = readEnv(env);
  validateEnvResolved(resolved);

  const urls = getConfiguredUrls();
  const allEvents: ParsedEvent[] = [];

  for (const sourceUrl of urls) {
    console.log("[processAllUrls] processing source:", sourceUrl);
    try {
      const eventPages = await discoverEventPages(sourceUrl);
      const results = await mapWithConcurrency(
        eventPages,
        EVENT_PROCESS_CONCURRENCY,
        async (eventUrl) => processEventUrl(eventUrl, resolved)
      );
      for (const r of results) {
        if (r) allEvents.push(r);
      }
    } catch (err) {
      console.error("[processAllUrls] failed source url:", sourceUrl, String(err));
    }
  }

  return allEvents;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/manual2")) {
      try {
        const events = await processAllUrls(env);
        return Response.json({ ok: true, count: events.length, events });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    if (request.method === "GET") {
      return Response.json({ ok: true, message: "Worker running. Use /manual2" });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },

  async scheduled(_event: any, env: Env): Promise<void> {
    try {
      const events = await processAllUrls(env);
      console.log("[scheduled] done. events:", events.length);
    } catch (err) {
      console.error("[scheduled] failed:", String(err));
    }
  },
};

