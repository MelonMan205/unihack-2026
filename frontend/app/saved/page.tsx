"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type SavedRow = {
  event_id: string;
  events: {
    id: string;
    title: string;
    venue: string | null;
    source_url: string | null;
    time_label: string | null;
  } | null;
};

function SavedInner() {
  const client = getSupabaseBrowserClient();
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(async ({ data }) => {
      const userId = data.session?.user?.id;
      if (!userId) return;
      const { data: savedData } = await client
        .from("saved_event_items")
        .select("event_id,events(id,title,venue,source_url,time_label)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      setRows((savedData as SavedRow[] | null) ?? []);
      setIsLoading(false);
    });
  }, [client]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">Saved Events</h1>
        {isLoading ? <p className="mt-3 text-sm text-zinc-600">Loading...</p> : null}
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <article key={row.event_id} className="rounded-xl border border-zinc-200 p-3">
              <p className="font-semibold text-zinc-900">{row.events?.title ?? "Unknown event"}</p>
              <p className="text-sm text-zinc-600">{row.events?.venue ?? "Venue TBA"}</p>
              <p className="text-xs text-zinc-500">{row.events?.time_label ?? "Time TBA"}</p>
              {row.events?.source_url ? (
                <a className="mt-2 inline-block text-sm text-zinc-700 underline" href={row.events.source_url} target="_blank" rel="noreferrer">
                  Open event source
                </a>
              ) : null}
            </article>
          ))}
          {!isLoading && rows.length === 0 ? <p className="text-sm text-zinc-600">No saved events yet.</p> : null}
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-zinc-700 underline">
          Back to map
        </Link>
      </div>
    </main>
  );
}

export default function SavedPage() {
  return (
    <AuthGate>
      <SavedInner />
    </AuthGate>
  );
}
