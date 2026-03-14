"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StatsRow = {
  total_checked_in: number;
  total_going: number;
  total_interested: number;
  total_actions: number;
};

type CategoryCount = {
  category: string | null;
  count: number;
};

function ProfileAnalyticsInner() {
  const client = getSupabaseBrowserClient();
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [categories, setCategories] = useState<CategoryCount[]>([]);

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id;
      if (!userId) return;

      const { data: statsRows } = await client
        .from("user_event_activity_stats")
        .select("total_checked_in,total_going,total_interested,total_actions")
        .eq("user_id", userId)
        .limit(1);
      setStats(((statsRows ?? [])[0] as StatsRow | undefined) ?? null);

      const { data: attendanceRows } = await client
        .from("event_attendance")
        .select("event_id,events(category)")
        .eq("user_id", userId);

      const bucket = new Map<string, number>();
      for (const row of attendanceRows ?? []) {
        const category = (row as { events?: { category?: string | null } | null }).events?.category ?? "uncategorized";
        bucket.set(category, (bucket.get(category) ?? 0) + 1);
      }
      const nextCategories = [...bucket.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
      setCategories(nextCategories);
    });
  }, [client]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">My Analytics</h1>
        <p className="mt-1 text-sm text-zinc-600">Your recent event activity and category trends.</p>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <article className="rounded-xl border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">Total actions</p>
            <p className="text-xl font-semibold text-zinc-900">{stats?.total_actions ?? 0}</p>
          </article>
          <article className="rounded-xl border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">Checked in</p>
            <p className="text-xl font-semibold text-zinc-900">{stats?.total_checked_in ?? 0}</p>
          </article>
          <article className="rounded-xl border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">Going</p>
            <p className="text-xl font-semibold text-zinc-900">{stats?.total_going ?? 0}</p>
          </article>
          <article className="rounded-xl border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">Interested</p>
            <p className="text-xl font-semibold text-zinc-900">{stats?.total_interested ?? 0}</p>
          </article>
        </div>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-zinc-900">Top categories</h2>
          <div className="mt-2 space-y-2">
            {categories.map((item) => (
              <div key={item.category ?? "uncategorized"} className="rounded-xl border border-zinc-200 p-3 text-sm text-zinc-700">
                {item.category ?? "uncategorized"}: {item.count}
              </div>
            ))}
            {categories.length === 0 ? <p className="text-sm text-zinc-600">No attendance data yet.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function ProfileAnalyticsPage() {
  return (
    <AuthGate>
      <ProfileAnalyticsInner />
    </AuthGate>
  );
}
