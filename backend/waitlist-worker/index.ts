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

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 385.76 407.59">
  <defs>
    <style>
      .cls-1 { fill: #facf3c; }
      .cls-2 { fill: #fff; }
      .cls-3 { fill: none; }
    </style>
  </defs>
  <rect class="cls-1" width="385.76" height="385.76" rx="76.39" ry="76.39"/>
  <path class="cls-2" d="M200.4,357.47l83.55-134.66c43.86-70.69-6.98-162.05-90.16-162.05h0c-83.19,0-134.02,91.36-90.16,162.05l83.55,134.66c3.05,4.91,10.2,4.91,13.24,0h0Z"/>
  <circle class="cls-1" cx="193.79" cy="168.42" r="72.87"/>
  <polygon class="cls-2" points="218.62 137.37 201.74 105.02 184.33 137.37 184.59 249 218.88 249 218.62 137.37"/>
  <g>
    <path class="cls-1" d="M201.95,157.89v82.93c17.1-1.78,32.41-9.1,43.84-20l-.77-79.41-43.07,16.49Z"/>
    <path class="cls-3" d="M201.95,152.19l43.09-15.86.75,83.12c12.9-13.15,20.87-31.15,20.87-51.02,0-40.24-32.62-72.87-72.87-72.87s-72.87,32.62-72.87,72.87,32.62,72.87,72.87,72.87c2.76,0,5.48-.17,8.16-.47v-88.63Z"/>
  </g>
  <line class="cls-3" x1="183.89" y1="407.59" x2="73.68" y2="257.3"/>
  <rect class="cls-2" x="138.24" y="160.48" width="41.13" height="106.72"/>
  <polygon class="cls-2" points="241.19 150.44 209.35 162.4 209.35 248.9 242.03 248.9 241.19 150.44"/>
  <g>
    <path class="cls-3" d="M193.79,95.56c-40.24,0-72.87,32.62-72.87,72.87,0,26.37,14,49.46,34.98,62.25v-58.65h33.22v69.1c1.55.1,3.1.16,4.67.16,40.24,0,72.87-32.62,72.87-72.87s-32.62-72.87-72.87-72.87Z"/>
    <path class="cls-1" d="M155.9,177.87v53.69c9.79,5.47,21.1,8.87,33.22,9.57v-63.26h-33.22Z"/>
  </g>
  <rect class="cls-2" x="162.32" y="184.35" width="20.12" height="65.41"/>
  <rect class="cls-2" x="146.76" y="144.15" width="24.11" height="26.21"/>
  <path class="cls-1" d="M219.97,236.42c14.69-5.45,27.08-15.35,35.39-27.99v-34.02h-35.39v62.01Z"/>
  <path class="cls-2" d="M225.99,180.72h17.22c8.58,0,15.55,6.97,15.55,15.55v53.5h-32.77v-69.04h0Z"/>
</svg>`;

const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Happs Waitlist</title>
    <meta name="description" content="Join the Happs waitlist for spontaneous events around Monash and Melbourne." />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="shortcut icon" href="/favicon.ico" />
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

    if (request.method === "GET" && (url.pathname === "/logo.svg" || url.pathname === "/favicon.ico")) {
      return new Response(LOGO_SVG, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=86400",
        },
      });
    }

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
