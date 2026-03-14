interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PUSH_WEBHOOK_URL?: string;
}

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function supabaseFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const baseUrl = normalizeBase(env.SUPABASE_URL || "");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
}

async function expireCheckins(env: Env): Promise<number> {
  const response = await supabaseFetch(env, "/rest/v1/rpc/app_expire_checkins", { method: "POST", body: "{}" });
  if (!response.ok) {
    console.error("[notification-worker] app_expire_checkins failed", response.status, await response.text());
    return 0;
  }
  const result = (await response.json().catch(() => 0)) as number;
  return Number(result || 0);
}

async function queueReminders(env: Env): Promise<number> {
  const response = await supabaseFetch(env, "/rest/v1/rpc/app_queue_event_reminders", {
    method: "POST",
    body: JSON.stringify({ window_minutes: 60 }),
  });
  if (!response.ok) {
    console.error("[notification-worker] app_queue_event_reminders failed", response.status, await response.text());
    return 0;
  }
  return Number((await response.json().catch(() => 0)) || 0);
}

async function refreshCrowdForecasts(env: Env): Promise<number> {
  const response = await supabaseFetch(env, "/rest/v1/rpc/app_refresh_crowd_forecasts", {
    method: "POST",
    body: "{}",
  });
  if (!response.ok) {
    console.error("[notification-worker] app_refresh_crowd_forecasts failed", response.status, await response.text());
    return 0;
  }
  return Number((await response.json().catch(() => 0)) || 0);
}

async function getQueuedNotifications(env: Env): Promise<NotificationRow[]> {
  const nowIso = new Date().toISOString();
  const query = `/rest/v1/notifications?select=id,user_id,title,body,payload&status=eq.queued&scheduled_for=lte.${encodeURIComponent(
    nowIso,
  )}&order=scheduled_for.asc&limit=100`;
  const response = await supabaseFetch(env, query, { method: "GET" });
  if (!response.ok) {
    console.error("[notification-worker] load queue failed", response.status, await response.text());
    return [];
  }
  return (await response.json().catch(() => [])) as NotificationRow[];
}

async function markNotificationSent(env: Env, notificationId: string): Promise<void> {
  await supabaseFetch(env, `/rest/v1/notifications?id=eq.${notificationId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "sent",
      sent_at: new Date().toISOString(),
    }),
  });
}

async function markNotificationFailed(env: Env, notificationId: string): Promise<void> {
  await supabaseFetch(env, `/rest/v1/notifications?id=eq.${notificationId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "failed",
    }),
  });
}

async function getDeviceTokens(env: Env, userId: string): Promise<string[]> {
  const response = await supabaseFetch(
    env,
    `/rest/v1/device_tokens?select=token&user_id=eq.${userId}&limit=50`,
    { method: "GET" },
  );
  if (!response.ok) {
    console.error("[notification-worker] token fetch failed", response.status, await response.text());
    return [];
  }
  const rows = (await response.json().catch(() => [])) as Array<{ token: string }>;
  return rows.map((row) => row.token).filter(Boolean);
}

async function dispatchPush(env: Env, notification: NotificationRow, tokens: string[]): Promise<void> {
  if (!env.PUSH_WEBHOOK_URL) {
    // Keep queue processing operational even when a push provider is not configured.
    console.log("[notification-worker] push webhook not configured", {
      notificationId: notification.id,
      tokenCount: tokens.length,
    });
    return;
  }

  const response = await fetch(env.PUSH_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      notificationId: notification.id,
      userId: notification.user_id,
      title: notification.title,
      body: notification.body,
      payload: notification.payload,
      tokens,
    }),
  });
  if (!response.ok) {
    throw new Error(`Push webhook failed: ${response.status}`);
  }
}

async function runDispatch(
  env: Env,
): Promise<{ queuedReminders: number; refreshedForecasts: number; expiredCheckins: number; processed: number; sent: number; failed: number }> {
  const queuedReminders = await queueReminders(env);
  const refreshedForecasts = await refreshCrowdForecasts(env);
  const expiredCheckins = await expireCheckins(env);
  const queued = await getQueuedNotifications(env);
  let sent = 0;
  let failed = 0;

  for (const notification of queued) {
    try {
      const tokens = await getDeviceTokens(env, notification.user_id);
      await dispatchPush(env, notification, tokens);
      await markNotificationSent(env, notification.id);
      sent += 1;
    } catch (error) {
      console.error("[notification-worker] dispatch failed", notification.id, error);
      await markNotificationFailed(env, notification.id);
      failed += 1;
    }
  }

  return { queuedReminders, refreshedForecasts, expiredCheckins, processed: queued.length, sent, failed };
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const result = await runDispatch(env);
    console.log("[notification-worker] scheduled result", result);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "notification-worker" });
    }
    if (request.method === "POST" && url.pathname === "/dispatch") {
      const result = await runDispatch(env);
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: "Not found" }, 404);
  },
};
