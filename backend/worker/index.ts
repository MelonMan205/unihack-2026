import urlsConfig from "./urls.json";
interface Env {
  GEMINI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
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
  lat: number | null;
  lng: number | null;
};
type ResolvedEnv = {
  gemini: string;
  accountId: string;
  cfToken: string;
};
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
const MAX_EVENT_PAGES_PER_SOURCE = 3;
const MAX_CANDIDATES_PER_SOURCE = 80;
const USER_AGENT = "Mozilla/5.0 (compatible; EventCrawler/1.0)";
const NOMINATIM_USER_AGENT = "EventCrawler/1.0 (contact: your-email@example.com)";
const MIN_NOMINATIM_GAP_MS = 1200;
```

```typescript path=/home/luke/code/projects/unihack-2026/backend/worker/index.ts start_line=81 end_line=170
// Rate-limit handling
const CF_MAX_RETRIES = 5;
const CF_BASE_BACKOFF_MS = 1200;
const CF_MAX_BACKOFF_MS = 20000;
// Concurrency controls
const ROBOTS_CONCURRENCY = 4;
const EVENT_PROCESS_CONCURRENCY = 2;
// Cache robots result per host+path to avoid repeated fetch/parse
const robotsCache = new Map<string, boolean>();
let nextNominatimAt = 0;

type GeocodeResult = {
  lat: number;
  lng: number;
};

function toValidatedGeocode(latRaw: unknown, lngRaw: unknown): GeocodeResult | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function geocodeLocation(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;

  const waitFor = nextNominatimAt - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  nextNominatimAt = Date.now() + MIN_NOMINATIM_GAP_MS;

  const endpoint =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&q=" +
    encodeURIComponent(q);

  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": NOMINATIM_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-AU,en;q=0.9",
    },
  });
  if (!res.ok) return null;

  const payload = (await res.json()) as unknown;
  const list = Array.isArray(payload)
    ? (payload as Array<{ lat?: string | number; lon?: string | number }>)
    : [];
  if (list.length === 0) return null;
  return toValidatedGeocode(list[0].lat, list[0].lon);
}
```

```typescript path=/home/luke/code/projects/unihack-2026/backend/worker/index.ts start_line=430 end_line=500
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

  const location = typeof obj?.location === "string" ? obj.location : null;
  const geo = location ? await geocodeLocation(location) : null;

  return {
    event_name: typeof obj?.event_name === "string" ? obj.event_name : null,
    description: typeof obj?.description === "string" ? obj.description : null,
    date: typeof obj?.date === "string" ? obj.date : null,
    time: typeof obj?.time === "string" ? obj.time : null,
    location,
    source_url: sourceUrl,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
  };
}

