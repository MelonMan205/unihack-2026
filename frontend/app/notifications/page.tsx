"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  type: string;
};

function NotificationsInner() {
  const client = getSupabaseBrowserClient();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState({
    event_reminders: true,
    social_activity: true,
    nearby_events: true,
    organizer_posts: true,
    push_enabled: true,
    in_app_enabled: true,
  });

  const loadRows = useCallback(async (currentUserId: string) => {
    if (!client) return;
    const { data } = await client
      .from("notifications")
      .select("id,title,body,created_at,read_at,type")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data as NotificationRow[] | null) ?? []);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(async ({ data }) => {
      const currentUserId = data.session?.user?.id ?? null;
      setUserId(currentUserId);
      if (currentUserId) {
        void loadRows(currentUserId);
        const { data: pref } = await client
          .from("notification_preferences")
          .select("event_reminders,social_activity,nearby_events,organizer_posts,push_enabled,in_app_enabled")
          .eq("user_id", currentUserId)
          .maybeSingle();
        if (pref) {
          setPreferences({
            event_reminders: Boolean(pref.event_reminders),
            social_activity: Boolean(pref.social_activity),
            nearby_events: Boolean(pref.nearby_events),
            organizer_posts: Boolean(pref.organizer_posts),
            push_enabled: Boolean(pref.push_enabled),
            in_app_enabled: Boolean(pref.in_app_enabled),
          });
        }
      }
    });
  }, [client, loadRows]);

  const updatePreference = async (key: keyof typeof preferences, value: boolean) => {
    if (!client || !userId) return;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    await client
      .from("notification_preferences")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
  };

  const markAsRead = async (notificationId: string) => {
    if (!client) return;
    const { error } = await client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
    if (!error && userId) {
      await loadRows(userId);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Notifications</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-600">In-app reminders and social activity updates.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(
            [
              ["event_reminders", "Event reminders"],
              ["social_activity", "Social activity"],
              ["nearby_events", "Nearby events"],
              ["organizer_posts", "Organizer posts"],
              ["push_enabled", "Push notifications"],
              ["in_app_enabled", "In-app notifications"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => void updatePreference(key, event.target.checked)}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <article key={row.id} className="rounded-xl border border-zinc-200 p-3">
              <p className="text-xs uppercase text-zinc-500">{row.type}</p>
              <p className="font-semibold text-zinc-900">{row.title}</p>
              <p className="text-sm text-zinc-700">{row.body}</p>
              <p className="mt-1 text-xs text-zinc-500">{new Date(row.created_at).toLocaleString()}</p>
              {row.read_at ? (
                <p className="mt-2 text-xs text-green-700">Read</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void markAsRead(row.id)}
                  className="mt-2 rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                >
                  Mark read
                </button>
              )}
            </article>
          ))}
          {rows.length === 0 ? <p className="text-sm text-zinc-600">No notifications yet.</p> : null}
        </div>
      </div>
    </main>
  );
}

export default function NotificationsPage() {
  return (
    <AuthGate>
      <NotificationsInner />
    </AuthGate>
  );
}
