import urlsConfig from "./urls.json";

interface Env {
  GEMINI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_KEY?: string;
}

type HtmlElement = {
  remove: () => void;
  getAttribute: (name: string) => string | null;
};

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

type SupabaseEventRow = {
  title: string;
  venue: string | null;
  time_label: string | null;
  photo_url: string | null;
  location: string | null;
  category: string | null;
  spontaneity_score: number | null;
  crowd_label: string | null;
  tags: string[] | null;
  description: string | null;
  source_url: string;
  created_at: string | null;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Max tokens budget for the full prompt.
 * Adjust this based on observed latency/errors.
 */
const MAX_PROMPT_TOKENS = 8000;

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
 * Keep enrichment prompts tighter than extraction prompts to avoid 524s.
 */
const MAX_POPULATION_PROMPT_TOKENS = 6000;
const POPULATION_PROMPT_OVERHEAD_TOKENS = 1600;
const MAX_POPULATION_SOURCE_CHARS_TOTAL = Math.max(
  1,
  (MAX_POPULATION_PROMPT_TOKENS - POPULATION_PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN_ESTIMATE,
);
const MAX_SOURCE_CONTENT_CHARS_PER_EVENT = 2500;

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

function compactWebText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPrompt(cleanedHtml: string): string {
  return [
    "Extract ONLY real event listings from this HTML.",
    "Do not return navigation/header/footer pages, social links, or generic site links.",
    "Each event must include a specific title and at least one of: date/time, venue, location, or event detail URL.",
    "If there are no real events visible in this HTML, return events as an empty array.",
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
    .on("script", {
      element: (el: HtmlElement) => {
        const type = (el.getAttribute("type") || "").toLowerCase();
        // Keep structured data payloads that often contain event metadata.
        if (type === "application/ld+json") return;
        el.remove();
      },
    })
    .on("style", { element: (el: HtmlElement) => el.remove() })
    .on("noscript", { element: (el: HtmlElement) => el.remove() })
    .on("nav", { element: (el: HtmlElement) => el.remove() })
    .on("footer", { element: (el: HtmlElement) => el.remove() })
    .on("aside", { element: (el: HtmlElement) => el.remove() })
    .on("svg", { element: (el: HtmlElement) => el.remove() })
    .on("form", { element: (el: HtmlElement) => el.remove() })
    .on("header", { element: (el: HtmlElement) => el.remove() });

  const rewritten = rewriter.transform(source);
  const raw = await rewritten.text();
  const compacted = compactWebText(raw);
  const text = compacted.slice(0, MAX_HTML_CHARS * 2);
  console.log("[sanitizeHTML] Sanitization complete", {
    rawChars: raw.length,
    compactedChars: compacted.length,
    finalChars: text.length,
    finalTokensEst: estimateTokensFromChars(text.length),
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
      created_at:
        typeof item.created_at === "string" && item.created_at.trim().length > 0
          ? item.created_at.trim()
          : undefined,
    }))
    .filter((item) => {
      const hasUsefulSignal =
        Boolean(item.time_label?.trim()) ||
        Boolean(item.venue?.trim()) ||
        Boolean(item.location?.trim()) ||
        Boolean(item.visit_more_url?.trim()) ||
        Boolean(item.source_url?.trim());
      return item.title.trim().length > 0 && hasUsefulSignal;
    });
}

function normalizeEventForInsert(event: EventPin): SupabaseEventRow {
  const createdAtRaw = event.created_at?.trim();
  const createdAtDate = createdAtRaw ? new Date(createdAtRaw) : null;
  const created_at =
    createdAtDate && !Number.isNaN(createdAtDate.getTime()) ? createdAtDate.toISOString() : null;

  const tags = Array.isArray(event.tags)
    ? event.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
    : null;

  return {
    title: (event.title ?? "").trim(),
    venue: event.venue?.trim() || null,
    time_label: event.time_label?.trim() || null,
    photo_url: event.photo_url?.trim() || null,
    location: event.location?.trim() || null,
    category: event.category?.trim() || null,
    spontaneity_score:
      typeof event.spontaneity_score === "number"
        ? Math.max(0, Math.min(100, Math.round(event.spontaneity_score)))
        : null,
    crowd_label: event.crowd_label?.trim() || null,
    tags: tags && tags.length > 0 ? tags : null,
    description: event.description?.trim() || null,
    source_url: event.source_url?.trim() || "",
    created_at,
  };
}

function isPostgrestKeyMismatchError(body: string): boolean {
  const text = body.toLowerCase();
  return text.includes("pgrst102") || text.includes("all object keys must match");
}

type EventPopulationPatch = {
  event_index: number;
  description?: string;
  crowd_label?: string;
  tags?: string[];
  spontaneity_score?: number;
};

type CrawlResult = {
  processed: number;
  inserted: number;
  events?: Omit<EventPin, "visit_more_url">[];
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

type PopulationSourceItem = {
  event_index: number;
  title: string;
  venue: string;
  time_label: string;
  location: string;
  category: string;
  source_url: string;
  source_content: string;
};

function applyPopulationSourceBudget(items: PopulationSourceItem[]): PopulationSourceItem[] {
  if (!items.length) return items;

  const perEventBudget = Math.max(
    400,
    Math.min(
      MAX_SOURCE_CONTENT_CHARS_PER_EVENT,
      Math.floor(MAX_POPULATION_SOURCE_CHARS_TOTAL / items.length),
    ),
  );

  const budgeted = items.map((item) => ({
    ...item,
    source_content: item.source_content.slice(0, perEventBudget),
  }));

  console.log("[applyPopulationSourceBudget] Applied source budget", {
    eventCount: items.length,
    perEventBudget,
    totalBudgetChars: MAX_POPULATION_SOURCE_CHARS_TOTAL,
    totalAfterChars: budgeted.reduce((acc, item) => acc + item.source_content.length, 0),
  });

  return budgeted;
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

  const sourcePayloadRaw = await Promise.all(
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
        source_content: compactWebText(sourceContent).slice(0, MAX_SOURCE_CONTENT_CHARS_PER_EVENT),
      };
    }),
  );
  let sourcePayload = applyPopulationSourceBudget(sourcePayloadRaw);

  console.log("[enrichEventsWithPopulationLayer] Source payload built", {
    eventCount: events.length,
    payloadChars: JSON.stringify({ events: sourcePayload }).length,
    sourceUrls: sourcePayload.map((item) => item.source_url),
  });

  let prompt = buildPopulationPrompt(JSON.stringify({ events: sourcePayload }));
  let promptTokensEst = estimateTokensFromChars(prompt.length);

  if (promptTokensEst > MAX_POPULATION_PROMPT_TOKENS) {
    let perEventBudget = Math.max(200, Math.floor(MAX_SOURCE_CONTENT_CHARS_PER_EVENT / 2));
    while (promptTokensEst > MAX_POPULATION_PROMPT_TOKENS && perEventBudget >= 200) {
      sourcePayload = sourcePayload.map((item) => ({
        ...item,
        source_content: item.source_content.slice(0, perEventBudget),
      }));
      prompt = buildPopulationPrompt(JSON.stringify({ events: sourcePayload }));
      promptTokensEst = estimateTokensFromChars(prompt.length);
      perEventBudget = Math.floor(perEventBudget * 0.7);
    }
  }

  console.log("[enrichEventsWithPopulationLayer] Enrichment prompt ready", {
    promptChars: prompt.length,
    promptTokensEst,
    maxPopulationPromptTokens: MAX_POPULATION_PROMPT_TOKENS,
  });

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
  console.log("[enrichEventsWithPopulationLayer] Gemini raw response", {
    status: res.status,
    durationMs,
    bodyPreview: clipForLog(responseText),
  });
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
  console.log("[enrichEventsWithPopulationLayer] Gemini candidate text preview", {
    textLength: rawText.length,
    textPreview: clipForLog(rawText),
  });
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

  console.log("[enrichEventsWithPopulationLayer] Parsed enrichment patches", {
    patchesRawCount: patchesRaw.length,
    validPatchesCount: patches.length,
    patchesPreview: clipForLog(JSON.stringify(patches)),
  });

  if (!patches.length) {
    console.warn("[enrichEventsWithPopulationLayer] No enrichment patches returned");
    return events;
  }

  const patchByIndex = new Map<number, EventPopulationPatch>();
  for (const patch of patches) patchByIndex.set(patch.event_index, patch);

  const enriched = events.map((event, index) => {
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

  console.log("[enrichEventsWithPopulationLayer] Enrichment merge complete", {
    totalEvents: enriched.length,
    enrichedWithDescription: enriched.filter((e) => Boolean(e.description)).length,
    enrichedWithCrowdLabel: enriched.filter((e) => Boolean(e.crowd_label)).length,
    enrichedWithTags: enriched.filter((e) => Array.isArray(e.tags) && e.tags.length > 0).length,
    enrichedWithSpontaneity: enriched.filter((e) => typeof e.spontaneity_score === "number").length,
    enrichedPreview: clipForLog(JSON.stringify(enriched)),
  });

  return enriched;
}

async function insertEventsToSupabase(events: EventPin[], env: Env): Promise<void> {
  if (!events.length) {
    console.log("[insertEventsToSupabase] No events to insert");
    return;
  }

  const supabaseToken = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || "").trim();
  const supabaseUrl = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!supabaseToken) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
  }
  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  const sanitizedEvents = events
    .map(normalizeEventForInsert)
    .filter((event) => event.title.length > 0 && event.source_url.length > 0);

  if (!sanitizedEvents.length) {
    console.warn("[insertEventsToSupabase] All events were filtered out after sanitization");
    return;
  }

  const dedupedEvents = Array.from(
    new Map(sanitizedEvents.map((event) => [`${event.title}::${event.source_url}`, event])).values(),
  );

  console.log("[insertEventsToSupabase] Inserting events:", dedupedEvents.length);
  const res = await fetch(`${supabaseUrl}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseToken,
      Authorization: `Bearer ${supabaseToken}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(dedupedEvents),
  });

  console.log("[insertEventsToSupabase] Supabase response status:", res.status);
  if (!res.ok) {
    const body = await res.text();
    if (!isPostgrestKeyMismatchError(body)) {
      throw new Error(`Supabase insert failed (${res.status}): ${body}`);
    }

    console.warn(
      "[insertEventsToSupabase] Bulk insert failed with key-shape mismatch, retrying row-by-row",
    );

    const rowErrors: string[] = [];
    let insertedCount = 0;

    for (const event of dedupedEvents) {
      const rowRes = await fetch(`${supabaseUrl}/rest/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseToken,
          Authorization: `Bearer ${supabaseToken}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(event),
      });

      if (!rowRes.ok) {
        const rowBody = await rowRes.text();
        rowErrors.push(`${event.title} => (${rowRes.status}) ${rowBody}`);
      } else {
        insertedCount += 1;
      }
    }

    console.log("[insertEventsToSupabase] Row-by-row insert summary", {
      total: dedupedEvents.length,
      inserted: insertedCount,
      failed: rowErrors.length,
      failedPreview: clipForLog(JSON.stringify(rowErrors), 2000),
    });

    if (rowErrors.length > 0) {
      throw new Error(`Supabase row inserts failed for ${rowErrors.length} events`);
    }
  }
}

async function runCrawl(urls: string[], env: Env, includeEventsInResult = false): Promise<CrawlResult> {
  let processed = 0;
  let inserted = 0;
  let eventsForResult: Omit<EventPin, "visit_more_url">[] | undefined = includeEventsInResult
    ? []
    : undefined;
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
    console.log("[runCrawl] Population layer complete", {
      selectedUrl,
      extractedCount: events.length,
      enrichedCount: eventsForInsert.length,
      enrichedPreview: clipForLog(JSON.stringify(eventsForInsert)),
    });

    await insertEventsToSupabase(eventsForInsert, env);

    if (includeEventsInResult) {
      eventsForResult = eventsForInsert;
    }

    processed = 1;
    inserted = eventsForInsert.length;
    console.log("[runCrawl] Completed URL:", selectedUrl, "processed:", processed, "inserted:", inserted);
  } catch (err) {
    console.error("[runCrawl] Error processing url:", selectedUrl, err);
  }

  console.log("[runCrawl] Finished crawl. Processed:", processed, "Inserted:", inserted);
  return { processed, inserted, events: eventsForResult };
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
        const result = await runCrawl(urls, env, true);
        console.log("[manual] Crawl finished:", result);
        return Response.json({
          ok: true,
          processed: result.processed,
          inserted: result.inserted,
          events: result.events ?? [],
        });
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
