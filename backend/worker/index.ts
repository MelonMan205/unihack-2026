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
  created_at?: string;
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MAX_PROMPT_CHARS = 120_000; // conservative guard to reduce 524 risk
const PROMPT_OVERHEAD_CHARS = 4_000; // reserved for instructions + JSON schema + labels
const MAX_HTML_CHARS = Math.max(1, MAX_PROMPT_CHARS - PROMPT_OVERHEAD_CHARS);

function buildPrompt(cleanedHtml: string): string {
  return "THIS IS A TEST";
  return [
    "Extract events and venues from this HTML.",
    "Return STRICT JSON only in this shape:",
    '{"events":[{"title":"string","venue":"string?","time_label":"string?","photo_url":"string?","location":"string?","category":"string?","spontaneity_score":"number?","crowd_label":"string?","tags":["string?"],"description":"string?","source_url":"string?","created_at":"string?"}],"links":["string?"]}',
    `HTML:\n${cleanedHtml}`,
  ].join("\n");
}

function enforceHtmlLengthLimit(html: string): { html: string; truncated: boolean } {
  if (html.length <= MAX_HTML_CHARS) {
    return { html, truncated: false };
  }
  return { html: html.slice(0, MAX_HTML_CHARS), truncated: true };
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
  console.log("[sanitizeHTML] Sanitization complete", { length: text.length });
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
      tags: Array.isArray(item.tags) ? item.tags.filter((x: any) => typeof x === "string") : undefined,
      description: item.description,
      source_url: "",
      created_at: item.created_at,
    }));
}

async function callGemini(cleanedHtml: string, apiKey: string): Promise<EventPin[]> {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const originalHtmlLength = cleanedHtml.length;
  const constrained = enforceHtmlLengthLimit(cleanedHtml);
  const constrainedHtmlLength = constrained.html.length;

  const prompt = buildPrompt(constrained.html);
  const promptLength = prompt.length;

  console.log("[callGemini] Prompt sizing", {
    originalHtmlLength,
    constrainedHtmlLength,
    htmlTruncated: constrained.truncated,
    maxHtmlChars: MAX_HTML_CHARS,
    promptLength,
    maxPromptChars: MAX_PROMPT_CHARS,
  });

  if (promptLength > MAX_PROMPT_CHARS) {
    throw new Error(
      `Prompt too large after truncation. promptLength=${promptLength}, maxPromptChars=${MAX_PROMPT_CHARS}`,
    );
  }

  console.log("[callGemini] Sending Gemini request");
  const startedAt = Date.now();

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  const durationMs = Date.now() - startedAt;
  console.log("[callGemini] Gemini response", { status: res.status, durationMs });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[callGemini] Gemini error body", {
      status: res.status,
      durationMs,
      bodyPreview: errBody.slice(0, 1000),
    });
    throw new Error(`Gemini request failed: ${res.status}`);
  }

  const data = await res.json();
  const rawText = getGeminiText(data);
  const maybeJson = extractFirstJsonObject(rawText);

  if (!maybeJson) {
    console.warn("[callGemini] No JSON object found in Gemini response", {
      rawTextLength: rawText.length,
      rawPreview: rawText.slice(0, 300),
    });
    return [];
  }

  const parsed = JSON.parse(maybeJson);
  const events = coerceEvents(parsed);
  console.log("[callGemini] Parsed events count:", events.length);
  return events;
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

    const eventsWithSource = events.map((event) => ({ ...event, source_url: selectedUrl }));
    await insertEventsToSupabase(eventsWithSource, env);

    processed = 1;
    inserted = eventsWithSource.length;
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

