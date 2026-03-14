interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

type JsonRecord = Record<string, unknown>;

const rateLimiter = new Map<string, { count: number; windowStart: number }>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseAuthToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

function checkRateLimit(request: Request, env: Env): boolean {
  const ip = getClientIp(request);
  const path = new URL(request.url).pathname;
  const key = `${ip}:${path}`;
  const now = Date.now();
  const oneMinute = 60_000;
  const limit = Number.parseInt(env.RATE_LIMIT_PER_MINUTE ?? "80", 10) || 80;
  const state = rateLimiter.get(key);

  if (!state || now - state.windowStart >= oneMinute) {
    rateLimiter.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (state.count >= limit) {
    return false;
  }

  state.count += 1;
  rateLimiter.set(key, state);
  return true;
}

async function parseBody(request: Request): Promise<JsonRecord> {
  return (await request.json().catch(() => ({}))) as JsonRecord;
}

async function supabaseRpc(
  env: Env,
  token: string,
  functionName: string,
  payload: JsonRecord,
): Promise<{ ok: boolean; data?: unknown; error?: string; status: number }> {
  const supabaseUrl = normalizeBaseUrl(env.SUPABASE_URL || "");
  if (!supabaseUrl || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, error: "Supabase config is missing", status: 500 };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    return { ok: false, error: data?.message || data?.error || text || "RPC failed", status: response.status };
  }
  return { ok: true, data, status: response.status };
}

async function supabaseTableWrite(
  env: Env,
  token: string,
  tableName: string,
  body: JsonRecord,
): Promise<{ ok: boolean; data?: unknown; error?: string; status: number }> {
  const supabaseUrl = normalizeBaseUrl(env.SUPABASE_URL || "");
  if (!supabaseUrl || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, error: "Supabase config is missing", status: 500 };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=representation",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    return { ok: false, error: data?.message || data?.error || text || "Write failed", status: response.status };
  }
  return { ok: true, data, status: response.status };
}

function decodeJwtSubject(token: string): string | null {
  try {
    const [, payloadPart] = token.split(".");
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function isAdmin(env: Env, token: string, userId: string): Promise<boolean> {
  const supabaseUrl = normalizeBaseUrl(env.SUPABASE_URL || "");
  const query = new URL(`${supabaseUrl}/rest/v1/user_roles`);
  query.searchParams.set("select", "user_id");
  query.searchParams.set("user_id", `eq.${userId}`);
  query.searchParams.set("role", "eq.admin");
  query.searchParams.set("limit", "1");

  const response = await fetch(query.toString(), {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return false;
  }

  const rows = (await response.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function routeRpc(
  request: Request,
  env: Env,
  token: string,
  rpcName: string,
  payloadMap: (body: JsonRecord) => JsonRecord,
): Promise<Response> {
  const body = await parseBody(request);
  const result = await supabaseRpc(env, token, rpcName, payloadMap(body));
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  return json({ ok: true, data: result.data });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "api-worker" });
    }

    if (!checkRateLimit(request, env)) {
      return json({ ok: false, error: "Rate limit exceeded" }, 429);
    }

    const token = parseAuthToken(request);
    if (!token) {
      return json({ ok: false, error: "Missing bearer token" }, 401);
    }
    const authUserId = decodeJwtSubject(token);
    if (!authUserId) {
      return json({ ok: false, error: "Invalid bearer token" }, 401);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/friend/request") {
      return routeRpc(request, env, token, "app_send_friend_request", (body) => ({
        target_user_id: String(body.targetUserId ?? ""),
      }));
    }

    if (url.pathname === "/friend/respond") {
      return routeRpc(request, env, token, "app_respond_friend_request", (body) => ({
        friendship_id: String(body.friendshipId ?? ""),
        decision: String(body.decision ?? ""),
      }));
    }

    if (url.pathname === "/friend/block") {
      return routeRpc(request, env, token, "app_block_user", (body) => ({
        target_user_id: String(body.targetUserId ?? ""),
      }));
    }

    if (url.pathname === "/attendance/set") {
      return routeRpc(request, env, token, "app_set_attendance", (body) => ({
        event_uuid: String(body.eventId ?? ""),
        attendance_status: String(body.status ?? ""),
        visibility_mode: String(body.visibility ?? "friends"),
      }));
    }

    if (url.pathname === "/checkin/create") {
      return routeRpc(request, env, token, "app_check_in", (body) => ({
        event_uuid: String(body.eventId ?? ""),
        ttl_minutes: Number(body.ttlMinutes ?? 240),
      }));
    }

    if (url.pathname === "/organizer/request") {
      const body = await parseBody(request);
      const result = await supabaseTableWrite(env, token, "organizer_verification_requests", {
        user_id: authUserId,
        organization_name: body.organizationName,
        organization_email: body.organizationEmail,
        website_url: body.websiteUrl || null,
        evidence: body.evidence || null,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, data: result.data });
    }

    if (url.pathname === "/share/event") {
      const body = await parseBody(request);
      const result = await supabaseTableWrite(env, token, "event_shares", {
        sender_id: authUserId,
        recipient_id: body.recipientId || null,
        event_id: body.eventId,
        channel: body.channel || "in_app",
        external_target: body.externalTarget || null,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, data: result.data });
    }

    if (url.pathname === "/report/create") {
      const body = await parseBody(request);
      const result = await supabaseTableWrite(env, token, "reports", {
        reporter_id: authUserId,
        target_type: body.targetType,
        target_user_id: body.targetUserId || null,
        target_event_id: body.targetEventId || null,
        reason: body.reason,
        details: body.details || null,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, data: result.data });
    }

    if (url.pathname === "/admin/organizer/review") {
      if (!(await isAdmin(env, token, authUserId))) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }
      return routeRpc(request, env, token, "app_admin_review_organizer_request", (body) => ({
        request_id: String(body.requestId ?? ""),
        approved: Boolean(body.approved),
        review_notes: typeof body.reviewNotes === "string" ? body.reviewNotes : null,
      }));
    }

    if (url.pathname === "/admin/checkins/expire") {
      if (!(await isAdmin(env, token, authUserId))) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }
      const result = await supabaseRpc(env, token, "app_expire_checkins", {});
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, expiredCount: result.data });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
