export default {
  async scheduled(_event: any, env: Env, _ctx: any): Promise<void> {
    const urls = parseUrlsFromEnv(env);
    console.log("[scheduled] URLs from env:", urls);
    if (!urls.length) {
      console.warn("[scheduled] No URLs found in env.URLS_JSON");
      return;
    }
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
    console.log("[fetch] Incoming payload:", payload);
    const urls = Array.isArray(payload.urls) ? payload.urls : parseUrlsFromEnv(env);
    console.log("[fetch] URLs to process:", urls);

    if (!urls.length) {
      console.warn("[fetch] No URLs provided in payload or env.URLS_JSON");
      return Response.json(
        { ok: false, error: "No urls provided. Send { urls: string[] } or set URLS_JSON secret." },
        { status: 400 },
      );
    }

    const result = await runCrawl(urls, env);
    console.log("[fetch] Crawl result:", result);
    return Response.json({ ok: true, ...result });
  },
};
async function runCrawl(urls: string[], env: Env): Promise<{ processed: number; inserted: number }> {
  let processed = 0;
  let inserted = 0;
  console.log("[runCrawl] URLs received:", urls);
  for (const url of urls) {
    try {
      console.log("[runCrawl] Processing URL:", url);
      const source = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!source.ok) {
        console.warn("[runCrawl] Fetch failed for URL:", url, "Status:", source.status);
        continue;
      }
      const cleaned = await sanitizeHTML(source);
      const events = await callGemini(cleaned, env.GEMINI_API_KEY);
      const eventsWithSource = events.map((event) => ({ ...event, source_url: url }));
      await insertEventsToSupabase(eventsWithSource, env);
      processed += 1;
      inserted += eventsWithSource.length;
      console.log("[runCrawl] Inserted events for URL:", url, "Count:", eventsWithSource.length);
    } catch (err) {
      console.error("Error processing url", url, err);
    }
  }
  console.log("[runCrawl] Finished. Processed:", processed, "Inserted:", inserted);
  return { processed, inserted };
}

function parseUrlsFromEnv(env: Env): string[] {
  if (!env.URLS_JSON) {
    console.warn("[parseUrlsFromEnv] env.URLS_JSON is missing");
    return [];
  }
  try {
    const parsed = JSON.parse(env.URLS_JSON);
    const urls = Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
    console.log("[parseUrlsFromEnv] Parsed URLs:", urls);
    return urls;
  } catch (err) {
    console.error("[parseUrlsFromEnv] Failed to parse env.URLS_JSON:", env.URLS_JSON, err);
    return [];
  }
}

