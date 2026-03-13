import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_KEY?: string;
}

type HtmlElement = { remove: () => void };

declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: { element: (el: HtmlElement) => void }): any;
    transform(response: Response): Response;
  };
};

type EventPin = {
  title: string;
  venue?: string;
  time_label?: string;
  photo_url?: string;
  location?: string;
  category?: string;
  spontaneity_score?: number;
  crowd_label?: string;
  tags?: string[];
  description?: string;
  source_url: string;
  visit_more_url?: string;
  created_at?: string;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Max tokens budget for the full prompt.
 * Adjust this based on observed latency/errors.
 */
const MAX_PROMPT_TOKENS = 12000;

/**
 * Approx chars per token for English/web text.
 * 4 is a common conservative approximation.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Reserve tokens for instruction/schema overhead (non-HTML text).
 */
const PROMPT_OVERHEAD_TOKENS = 1200;

/**
 * Derived max HTML chars allowed before calling Gemini.
 */
const MAX_HTML_CHARS = Math.max(
  1,
  (MAX_PROMPT_TOKENS - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN_ESTIMATE,
);

/**
 * Hard cap log preview sizes to avoid huge observability payloads.
 */
const LOG_PREVIEW_CHARS = 3000;

function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);
}

function clipForLog(text: string, max = LOG_PREVIEW_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated ${text.length - max} chars]`;
}

function buildPrompt(cleanedHtml: string): string {
  return [
    "Extract events and venues from this HTML.",
    "Return STRICT JSON only in this shape:",
    '{"events":[{"title":"string","venue":"string?","time_label":"string?","photo_url":"string?","location":"string?","category":"string?","spontaneity_score":"number?","crowd_label":"string?","tags":["string?"],"description":"string?","source_url":"string?","visit_more_url":"string?","created_at":"string?"}],"links":["string?"]}',
    `HTML:\n${cleanedHtml}`,
  ].join("\n");
}

function buildPopulationPrompt(payload: string): string {
  return [
    "You are enriching extracted events with source content.",
    "Use each event's source_content to infer missing details and improve quality.",
    "For each event return only these fields: description, crowd_label, tags, spontaneity_score.",
    "Rules:",
    '- description: concise 1-3 sentences; use source_content facts; if unknown return "".',
    '- crowd_label: one of ["quiet","moderate","busy","packed"] or "" if unknown.',
    "- tags: 2-6 short lowercase tags.",
    "- spontaneity_score: integer 0-100 based on effort/planning needed (higher = more spontaneous).",
    "Return STRICT JSON only in this exact shape:",
    '{"events":[{"event_index":"number","description":"string","crowd_label":"string","tags":["string"],"spontaneity_score":"number"}]}',
    `INPUT:\n${payload}`,
  ].join("\n");
}

function enforceHtmlTokenBudget(html: string): {
  html: string;
  truncated: boolean;
  originalChars: number;
  finalChars: number;
  originalTokensEst: number;
  finalTokensEst: number;
} {
  const originalChars = html.length;
  const originalTokensEst = estimateTokensFromChars(originalChars);

  if (originalChars <= MAX_HTML_CHARS) {
    return {
      html,
      truncated: false,
      originalChars,
      finalChars: originalChars,
      originalTokensEst,
      finalTokensEst: originalTokensEst,
    };
  }

  const sliced = html.slice(0, MAX_HTML_CHARS);
  return {
    html: sliced,
    truncated: true,
    originalChars,
    finalChars: sliced.length,
    originalTokensEst,
    finalTokensEst: estimateTokensFromChars(sliced.length),
  };
}

async function sanitizeHTML(source: Response): Promise<string> {
  console.log("[sanitizeHTML] Starting HTML sanitization");
  const rewriter = new HTMLRewriter()
    .on("script", { element: (el: HtmlElement) => el.remove() })
    .on("style", { element: (el: HtmlElement) => el.remove() })
    .on("noscript", { element: (el: HtmlElement) => el.remove() })
    .on("nav", { element: (el: HtmlElement) => el.remove() })
    .on("footer", { element: (el: HtmlElement) => el.remove() })
    .on("aside", { element: (el: HtmlElement) => el.remove() });

  const rewritten = rewriter.transform(source);
  const text = await rewritten.text();
  console.log("[sanitizeHTML] Sanitization complete", {
    lengthChars: text.length,
    tokensEst: estimateTokensFromChars(text.length),
  });
  return text;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function getGeminiText(data: any): string {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function coerceEvents(payload: any): EventPin[] {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events
    .filter((item: any) => typeof item?.title === "string")
    .map((item: any) => ({
      title: item.title,
      venue: item.venue,
      time_label: item.time_label,
      photo_url: item.photo_url,
      location: item.location,
      category: item.category,
      spontaneity_score:
        typeof item.spontaneity_score === "number" ? item.spontaneity_score : undefined,
      crowd_label: item.crowd_label,
      tags: Array.isArray(item.tags)
        ? item.tags.filter((x: any) => typeof x === "string")
        : undefined,
      description: item.description,
      source_url: typeof item.source_url === "string" ? item.source_url : "",
      visit_more_url: typeof item.visit_more_url === "string" ? item.visit_more_url : undefined,
      created_at: item.created_at,
    }));
}

type EventPopulationPatch = {
  event_index: number;
  description?: string;
  crowd_label?: string;
  tags?: string[];
  spontaneity_score?: number;
};

function extractJsonPayload(text: string): any | null {
  const maybeJson = extractFirstJsonObject(text);
  if (!maybeJson) return null;
  try {
    return JSON.parse(maybeJson);
  } catch (err) {
    console.error("[extractJsonPayload] Failed to parse extracted JSON object", {
      extractedPreview: clipForLog(maybeJson),
      err: String(err),
    });
    return null;
  }
}

function resolveUrl(baseUrl: string, maybeUrl?: string): string {
  const value = (maybeUrl ?? "").trim();
  if (!value) return baseUrl;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

async function callGemini(cleanedHtml: string, apiKey: string): Promise<EventPin[]> {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const constrained = enforceHtmlTokenBudget(cleanedHtml);
  console.log("[callGemini] HTML budget check", {
    maxPromptTokens: MAX_PROMPT_TOKENS,
    promptOverheadTokens: PROMPT_OVERHEAD_TOKENS,
    maxHtmlChars: MAX_HTML_CHARS,
    ...constrained,
  });

  const prompt = buildPrompt(constrained.html);
  const promptChars = prompt.length;
  const promptTokensEst = estimateTokensFromChars(promptChars);

  console.log("[callGemini] Prompt ready", {
    promptChars,
    promptTokensEst,
    maxPromptTokens: MAX_PROMPT_TOKENS,
  });

  if (promptTokensEst > MAX_PROMPT_TOKENS) {
    throw new Error(
      `Prompt token estimate exceeds max: ${promptTokensEst} > ${MAX_PROMPT_TOKENS}`,
    );
  }

  const startedAt = Date.now();
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  const durationMs = Date.now() - startedAt;

  console.log("[callGemini] Gemini response status", { status: res.status, durationMs });

  const responseText = await res.text();
  console.log("[callGemini] Gemini raw response text", {
    status: res.status,
    durationMs,
    bodyPreview: clipForLog(responseText),
  });

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status}`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    console.error("[callGemini] Failed to parse Gemini JSON response", err);
    throw new Error("Gemini returned non-JSON response");
  }

  const rawText = getGeminiText(data);
  console.log("[callGemini] Gemini candidate text preview", {
    textPreview: clipForLog(rawText),
    textLength: rawText.length,
  });

  const parsed = extractJsonPayload(rawText);
  if (!parsed) {
    console.warn("[callGemini] No JSON object found in Gemini candidate text");
    return [];
  }

  console.log("[callGemini] Final parsed JSON", {
    jsonPreview: clipForLog(JSON.stringify(parsed)),
  });

  const events = coerceEvents(parsed);
  console.log("[callGemini] Parsed events count:", events.length);
  return events;
}

async function enrichEventsWithPopulationLayer(
  events: EventPin[],
  fallbackSourceUrl: string,
  apiKey: string,
): Promise<EventPin[]> {
  if (!events.length) return events;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const sourcePayload = await Promise.all(
    events.map(async (event, index) => {
      const preferredUrl = resolveUrl(fallbackSourceUrl, event.visit_more_url || event.source_url);
      let sourceContent = "";

      try {
        const res = await fetch(preferredUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (res.ok) {
          sourceContent = await sanitizeHTML(res);
        } else {
          console.warn("[enrichEventsWithPopulationLayer] Non-OK source content response", {
            eventIndex: index,
            status: res.status,
            preferredUrl,
          });
        }
      } catch (err) {
        console.warn("[enrichEventsWithPopulationLayer] Failed to fetch source content", {
          eventIndex: index,
          preferredUrl,
          err: String(err),
        });
      }

      return {
        event_index: index,
        title: event.title,
        venue: event.venue ?? "",
        time_label: event.time_label ?? "",
        location: event.location ?? "",
        category: event.category ?? "",
        source_url: preferredUrl,
        source_content: clipForLog(sourceContent, 6000),
      };
    }),
  );

  const prompt = buildPopulationPrompt(JSON.stringify({ events: sourcePayload }));
  const startedAt = Date.now();
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  const durationMs = Date.now() - startedAt;

  console.log("[enrichEventsWithPopulationLayer] Gemini response status", {
    status: res.status,
    durationMs,
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini enrichment request failed: ${res.status} :: ${clipForLog(responseText, 1000)}`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    console.error("[enrichEventsWithPopulationLayer] Failed to parse Gemini JSON response", err);
    return events;
  }

  const rawText = getGeminiText(data);
  const parsed = extractJsonPayload(rawText);
  const patchesRaw = Array.isArray(parsed?.events) ? parsed.events : [];
  const patches: EventPopulationPatch[] = patchesRaw
    .map((item: any) => ({
      event_index: typeof item?.event_index === "number" ? item.event_index : -1,
      description: typeof item?.description === "string" ? item.description : undefined,
      crowd_label: typeof item?.crowd_label === "string" ? item.crowd_label : undefined,
      tags: Array.isArray(item?.tags) ? item.tags.filter((x: any) => typeof x === "string") : undefined,
      spontaneity_score: typeof item?.spontaneity_score === "number" ? item.spontaneity_score : undefined,
    }))
    .filter((patch) => patch.event_index >= 0 && patch.event_index < events.length);

  if (!patches.length) {
    console.warn("[enrichEventsWithPopulationLayer] No enrichment patches returned");
    return events;
  }

  const patchByIndex = new Map<number, EventPopulationPatch>();
  for (const patch of patches) patchByIndex.set(patch.event_index, patch);

  return events.map((event, index) => {
    const patch = patchByIndex.get(index);
    const resolvedSourceUrl = resolveUrl(fallbackSourceUrl, event.visit_more_url || event.source_url);
    if (!patch) return { ...event, source_url: resolvedSourceUrl };
    return {
      ...event,
      source_url: resolvedSourceUrl,
      description: patch.description ?? event.description,
      crowd_label: patch.crowd_label ?? event.crowd_label,
      tags: patch.tags ?? event.tags,
      spontaneity_score: patch.spontaneity_score ?? event.spontaneity_score,
    };
  });
}

async function insertEventsToSupabase(events: EventPin[], env: Env): Promise<void> {
  if (!events.length) {
    console.log("[insertEventsToSupabase] No events to insert");
    return;
  }

  const supabaseToken = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!supabaseToken) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
  }

  console.log("[insertEventsToSupabase] Inserting events:", events.length);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseToken,
      Authorization: `Bearer ${supabaseToken}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(events),
  });

  console.log("[insertEventsToSupabase] Supabase response status:", res.status);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed (${res.status}): ${body}`);
  }
}

async function runCrawl(urls: string[], env: Env): Promise<{ processed: number; inserted: number }> {
  let processed = 0;
  let inserted = 0;
  console.log("[runCrawl] Starting crawl. URL count:", urls.length);

  if (!urls.length) {
    console.warn("[runCrawl] No URLs to process");
    return { processed, inserted };
  }

  const randomIndex = Math.floor(Math.random() * urls.length);
  const selectedUrl = urls[randomIndex];
  console.log("[runCrawl] Randomly selected URL:", selectedUrl, "index:", randomIndex);

  try {
    console.log("[runCrawl] Fetching URL:", selectedUrl);
    const source = await fetch(selectedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    console.log("[runCrawl] Source status for", selectedUrl, ":", source.status);

    if (!source.ok) {
      console.warn("[runCrawl] Skipping URL due to non-OK response:", selectedUrl);
      return { processed, inserted };
    }

    const cleaned = await sanitizeHTML(source);
    console.log("[runCrawl] Cleaned HTML length for", selectedUrl, ":", cleaned.length);

    const events = await callGemini(cleaned, env.GEMINI_API_KEY);
    console.log("[runCrawl] Events extracted for", selectedUrl, ":", events.length);

    const populatedEvents = await enrichEventsWithPopulationLayer(events, selectedUrl, env.GEMINI_API_KEY);
    const eventsForInsert = populatedEvents.map(({ visit_more_url: _omit, ...event }) => event);
    await insertEventsToSupabase(eventsForInsert, env);

    processed = 1;
    inserted = eventsForInsert.length;
    console.log("[runCrawl] Completed URL:", selectedUrl, "processed:", processed, "inserted:", inserted);
  } catch (err) {
    console.error("[runCrawl] Error processing url:", selectedUrl, err);
  }

  console.log("[runCrawl] Finished crawl. Processed:", processed, "Inserted:", inserted);
  return { processed, inserted };
}

function getConfiguredUrls(): string[] {
  const rawUrls = Array.isArray((urlsConfig as any)?.urls) ? (urlsConfig as any).urls : [];
  const urls = rawUrls
    .filter((u: unknown) => typeof u === "string")
    .map((u: string) => u.trim())
    .filter((u: string) => u.length > 0);

  console.log("[getConfiguredUrls] Loaded URLs count:", urls.length);
  return urls;
}

function isManualTriggerPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.length ? segments[segments.length - 1].toLowerCase() : "";
  return last === "manual";
}

export default {
  async scheduled(_event: any, env: Env, _ctx: any): Promise<void> {
    console.log("[scheduled] Triggered");
    const urls = getConfiguredUrls();
    if (!urls.length) {
      console.warn("[scheduled] No configured URLs");
      return;
    }
    const result = await runCrawl(urls, env);
    console.log("[scheduled] Done:", result);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    console.log("[fetch] Incoming request", { method: request.method, path: url.pathname });

    if (request.method === "GET" && isManualTriggerPath(url.pathname)) {
      console.log("[manual] Trigger received:", url.pathname);
      const urls = getConfiguredUrls();
      console.log("[manual] URLs resolved:", urls);

      if (!urls.length) {
        console.warn("[manual] No URLs configured in urls.json");
        return Response.json({ ok: false, error: "No URLs configured in urls.json." }, { status: 400 });
      }

      try {
        console.log("[manual] Starting crawl");
        const result = await runCrawl(urls, env);
        console.log("[manual] Crawl finished:", result);

        return new Response(
          [
            "Manual scrape complete.",
            `Processed URLs: ${result.processed}`,
            `Inserted events: ${result.inserted}`,
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      } catch (err) {
        console.error("[manual] Crawl failed:", err);
        return Response.json(
          { ok: false, error: "Manual crawl failed", details: String(err) },
          { status: 500 },
        );
      }
    }

    if (request.method === "GET") {
      return Response.json({ ok: true, message: "Worker is running" });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json().catch(() => ({}))) as { urls?: string[] };
    const urls = Array.isArray(payload.urls) ? payload.urls : getConfiguredUrls();

    if (!urls.length) {
      return Response.json(
        { ok: false, error: "No urls provided. Send { urls: string[] } or configure urls.json." },
        { status: 400 },
      );
    }

    const result = await runCrawl(urls, env);
    return Response.json({ ok: true, ...result });
  },
};
