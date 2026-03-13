interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_KEY?: string;
  URLS_JSON?: string;
}

declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: { element: (el: any) => void }): any;
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

async function sanitizeHTML(source: Response): Promise<string> {
  // Use Workers' built-in HTMLRewriter (no npm import needed).
  const rewriter = new HTMLRewriter()
    .on("script", { element: (el) => el.remove() })
    .on("style", { element: (el) => el.remove() })
    .on("noscript", { element: (el) => el.remove() })
    .on("nav", { element: (el) => el.remove() })
    .on("footer", { element: (el) => el.remove() })
    .on("aside", { element: (el) => el.remove() });

  const rewritten = rewriter.transform(source);
  return rewritten.text();
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
        typeof item.spontaneity_score === "number"
          ? item.spontaneity_score
          : undefined,
      crowd_label: item.crowd_label,
      tags: Array.isArray(item.tags) ? item.tags.filter((x: any) => typeof x === "string") : undefined,
      description: item.description,
      source_url: "",
      created_at: item.created_at,
    }));
}

async function callGemini(cleanedHtml: string, apiKey: string): Promise<EventPin[]> {
  const prompt = [
    "Extract events and venues from this HTML.",
    "Return STRICT JSON only in this shape:",
    '{"events":[{"title":"string","venue":"string?","time_label":"string?","photo_url":"string?","location":"string?","category":"string?","spontaneity_score":"number?","crowd_label":"string?","tags":["string?"],"description":"string?","source_url":"string?","created_at":"string?"}],"links":["string?"]}',
    `HTML:\n${cleanedHtml}`,
  ].join("\n");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status}`);
  }

  const data = await res.json();
  const rawText = getGeminiText(data);
  const maybeJson = extractFirstJsonObject(rawText);
  if (!maybeJson) return [];
  const parsed = JSON.parse(maybeJson);
  return coerceEvents(parsed);
}

async function insertEventsToSupabase(events: EventPin[], env: Env): Promise<void> {
  if (!events.length) return;
  const supabaseToken = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!supabaseToken) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
  }

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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed (${res.status}): ${body}`);
  }
}

async function runCrawl(urls: string[], env: Env): Promise<{ processed: number; inserted: number }> {
  let processed = 0;
  let inserted = 0;

  for (const url of urls) {
    try {
      const source = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!source.ok) continue;

      const cleaned = await sanitizeHTML(source);
      const events = await callGemini(cleaned, env.GEMINI_API_KEY);
      const eventsWithSource = events.map((event) => ({ ...event, source_url: url }));
      await insertEventsToSupabase(eventsWithSource, env);

      processed += 1;
      inserted += eventsWithSource.length;
    } catch (err) {
      console.error("Error processing url", url, err);
    }
  }

  return { processed, inserted };
}

function parseUrlsFromEnv(env: Env): string[] {
  if (!env.URLS_JSON) return [];
  try {
    const parsed = JSON.parse(env.URLS_JSON);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export default {
  async scheduled(_event: any, env: Env, _ctx: any): Promise<void> {
    const urls = parseUrlsFromEnv(env);
    if (!urls.length) return;
    await runCrawl(urls, env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET") {
      return Response.json({ ok: true, message: "Worker is running" });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json().catch(() => ({}))) as { urls?: string[] };
    const urls = Array.isArray(payload.urls) ? payload.urls : parseUrlsFromEnv(env);

    if (!urls.length) {
      return Response.json(
        { ok: false, error: "No urls provided. Send { urls: string[] } or set URLS_JSON secret." },
        { status: 400 },
      );
    }

    const result = await runCrawl(urls, env);
    return Response.json({ ok: true, ...result });
  },
};

