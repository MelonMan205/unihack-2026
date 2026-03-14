interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

type WaitlistPayload = {
  full_name: string;
  email: string;
  suburb?: string;
  intent?: string;
};

const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Happs Waitlist</title>
    <meta name="description" content="Join the Happs waitlist for spontaneous events around Monash and Melbourne." />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg: #eef1f5;
        --panel: rgba(255, 255, 255, 0.74);
        --panel-border: rgba(255, 255, 255, 0.62);
        --text: #0f172a;
        --muted: #475569;
        --accent: #facc15;
        --accent-strong: #eab308;
        --radius-panel: 20px;
        --radius-control: 14px;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        min-height: 100%;
      }

      body {
        font-family:
          "Space Mono",
          ui-monospace,
          "SF Mono",
          "JetBrains Mono",
          system-ui,
          -apple-system,
          Segoe UI,
          Roboto,
          Helvetica,
          Arial,
          sans-serif;
        color: var(--text);
        background: var(--bg);
        overflow-x: hidden;
      }

      .map-backdrop {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(115deg, rgba(238, 241, 245, 0.36), rgba(238, 241, 245, 0.1)),
          radial-gradient(circle at 22% 35%, rgba(250, 204, 21, 0.16), transparent 34%),
          radial-gradient(circle at 78% 22%, rgba(59, 130, 246, 0.12), transparent 30%),
          url("https://staticmap.openstreetmap.de/staticmap.php?center=-37.8136,144.9631&zoom=11&size=1800x1200&maptype=mapnik");
        background-size: cover;
        background-position: center;
        filter: blur(2.5px) saturate(1.04) contrast(1);
        transform: scale(1.01);
        opacity: 0.98;
        animation: mapIn 650ms ease-out both;
      }

      .map-backdrop::after {
        content: "";
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(
            24deg,
            rgba(255, 255, 255, 0.1) 0px,
            rgba(255, 255, 255, 0.1) 2px,
            transparent 2px,
            transparent 42px
          ),
          repeating-linear-gradient(
            -34deg,
            rgba(15, 23, 42, 0.06) 0px,
            rgba(15, 23, 42, 0.06) 1px,
            transparent 1px,
            transparent 38px
          );
        mix-blend-mode: soft-light;
      }

      .map-backdrop::before {
        content: "";
        position: absolute;
        width: 380px;
        height: 380px;
        right: -100px;
        top: -120px;
        border-radius: 999px;
        background: rgba(250, 204, 21, 0.2);
        filter: blur(40px);
      }

      .shell {
        position: relative;
        z-index: 1;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
      }

      .panel {
        width: min(720px, 100%);
        border-radius: var(--radius-panel);
        background: var(--panel);
        border: 1px solid var(--panel-border);
        box-shadow:
          0 10px 28px rgba(15, 23, 42, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        backdrop-filter: blur(18px) saturate(1.1);
        padding: 20px;
        animation: panelIn 500ms cubic-bezier(0.2, 0.7, 0.2, 1) 70ms both;
      }

      @media (min-width: 640px) {
        .panel {
          padding: 28px;
        }
      }

      .eyebrow {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: #64748b;
      }

      h1 {
        margin: 8px 0 10px;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.1;
      }

      .sub {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }

      form {
        margin-top: 18px;
        display: grid;
        gap: 12px;
      }

      label {
        display: grid;
        gap: 7px;
        font-size: 12px;
        color: #334155;
      }

      input, textarea {
        width: 100%;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: var(--radius-control);
        background: rgba(255, 255, 255, 0.86);
        color: #0f172a;
        font: inherit;
        padding: 12px 13px;
        outline: none;
      }

      input:focus, textarea:focus {
        border-color: rgba(100, 116, 139, 0.8);
      }

      textarea {
        min-height: 92px;
        resize: vertical;
      }

      .row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
      }

      @media (min-width: 700px) {
        .row {
          grid-template-columns: 1fr 1fr;
        }
      }

      .button {
        border: 0;
        border-radius: var(--radius-control);
        height: 46px;
        padding: 0 18px;
        font: inherit;
        font-weight: 700;
        color: #0f172a;
        background: var(--accent);
        cursor: pointer;
      }

      .button:hover {
        background: var(--accent-strong);
      }

      .button:disabled {
        opacity: 0.72;
        cursor: progress;
      }

      .meta {
        margin-top: 12px;
        font-size: 12px;
        color: #64748b;
      }

      .status {
        margin-top: 10px;
        min-height: 20px;
        font-size: 13px;
      }

      .status.error {
        color: #b91c1c;
      }

      .status.ok {
        color: #166534;
      }

      @keyframes mapIn {
        from {
          opacity: 0;
          transform: scale(1.025);
        }
        to {
          opacity: 0.98;
          transform: scale(1.01);
        }
      }

      @keyframes panelIn {
        from {
          opacity: 0;
          transform: translateY(14px) scale(0.992);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .map-backdrop,
        .panel {
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="map-backdrop" aria-hidden="true"></div>
    <main class="shell">
      <section class="panel">
        <p class="eyebrow">Tonight nearby</p>
        <h1>Join the Happs waitlist</h1>
        <p class="sub">Get early access to spontaneous Monash + Melbourne events as we launch.</p>

        <form id="waitlist-form">
          <div class="row">
            <label>
              Full name
              <input type="text" name="full_name" minlength="2" maxlength="120" required />
            </label>
            <label>
              Email
              <input type="email" name="email" maxlength="200" required />
            </label>
          </div>

          <label>
            Suburb (optional)
            <input type="text" name="suburb" maxlength="120" placeholder="e.g. Clayton, Glen Waverley, CBD" />
          </label>

          <label>
            What do you want from Happs? (optional)
            <textarea name="intent" maxlength="700" placeholder="Music gigs, food popups, social plans..."></textarea>
          </label>

          <button class="button" type="submit" id="submit-btn">Join waitlist</button>
        </form>

        <div id="status" class="status" role="status" aria-live="polite"></div>
        <p class="meta">We only use this to contact you about launch access.</p>
      </section>
    </main>

    <script>
      const form = document.getElementById("waitlist-form");
      const statusNode = document.getElementById("status");
      const submitBtn = document.getElementById("submit-btn");

      function setStatus(text, ok) {
        statusNode.textContent = text || "";
        statusNode.className = "status " + (ok ? "ok" : "error");
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus("", false);
        submitBtn.disabled = true;

        const formData = new FormData(form);
        const payload = {
          full_name: String(formData.get("full_name") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          suburb: String(formData.get("suburb") || "").trim(),
          intent: String(formData.get("intent") || "").trim()
        };

        try {
          const response = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(body.error || "Could not join waitlist");
          }

          form.reset();
          setStatus("You're on the list. We'll be in touch soon.", true);
        } catch (error) {
          setStatus(error.message || "Something went wrong. Please try again.", false);
        } finally {
          submitBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function trimText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function parsePayload(request: Request): Promise<WaitlistPayload | null> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = (await request.json()) as Record<string, unknown>;
    return {
      full_name: trimText(data.full_name, 120),
      email: trimText(data.email, 200).toLowerCase(),
      suburb: trimText(data.suburb, 120),
      intent: trimText(data.intent, 700),
    };
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const data = await request.formData();
    return {
      full_name: trimText(data.get("full_name"), 120),
      email: trimText(data.get("email"), 200).toLowerCase(),
      suburb: trimText(data.get("suburb"), 120),
      intent: trimText(data.get("intent"), 700),
    };
  }

  return null;
}

async function insertWaitlistRow(payload: WaitlistPayload, request: Request, env: Env): Promise<Response> {
  if (!payload.full_name || payload.full_name.length < 2) {
    return json({ error: "Please enter your full name." }, 400);
  }
  if (!payload.email || !isValidEmail(payload.email)) {
    return json({ error: "Please enter a valid email." }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server is missing Supabase configuration." }, 500);
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/waitlist_signups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal,resolution=ignore-duplicates",
    },
    body: JSON.stringify([
      {
        full_name: payload.full_name,
        email: payload.email,
        suburb: payload.suburb || null,
        intent: payload.intent || null,
        source: "waitlist-worker",
        user_agent: request.headers.get("user-agent") || null,
      },
    ]),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[waitlist] insert failed", res.status, errText);
    return json({ error: "Could not save your details right now." }, 502);
  }

  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/waitlist") {
      const payload = await parsePayload(request);
      if (!payload) {
        return json({ error: "Unsupported content type." }, 415);
      }
      return insertWaitlistRow(payload, request, env);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/waitlist")) {
      return new Response(PAGE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }

    return json({ error: "Not found" }, 404);
  },
};
