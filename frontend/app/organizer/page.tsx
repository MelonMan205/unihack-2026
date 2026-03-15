"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isOrganizerUser } from "@/lib/roles";

type EventRow = {
  id: string;
  title: string;
  venue: string | null;
  time_label: string | null;
  category: string | null;
  source_url: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  tags: string[] | null;
};

type MetricRow = {
  event_id: string;
  view_count: number;
  interested_count: number;
  going_count: number;
  active_checkins: number;
};

type EventDraft = {
  title: string;
  venue: string;
  timeLabel: string;
  category: string;
  sourceUrl: string;
  location: string;
  startAt: string;
  endAt: string;
  tags: string;
};

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function OrganizerInner() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [metrics, setMetrics] = useState<Record<string, MetricRow>>({});
  const [orgName, setOrgName] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [newEvent, setNewEvent] = useState<EventDraft>({
    title: "",
    venue: "",
    timeLabel: "",
    category: "social",
    sourceUrl: "",
    location: "-37.8136,144.9631",
    startAt: "",
    endAt: "",
    tags: "",
  });
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEvent, setEditEvent] = useState<EventDraft>({
    title: "",
    venue: "",
    timeLabel: "",
    category: "social",
    sourceUrl: "",
    location: "-37.8136,144.9631",
    startAt: "",
    endAt: "",
    tags: "",
  });

  const loadData = useCallback(async (uid: string) => {
    if (!client) return;
    const organizerFlag = await isOrganizerUser(client, uid);
    setIsOrganizer(organizerFlag);
    if (!organizerFlag) return;

    const { data: eventData } = await client
      .from("events")
      .select("id,title,venue,time_label,category,source_url,location,start_at,end_at,tags")
      .eq("created_by", uid)
      .order("created_at", { ascending: false });
    setEvents((eventData as EventRow[] | null) ?? []);

    const { data: metricData } = await client
      .from("organizer_event_metrics")
      .select("event_id,view_count,interested_count,going_count,active_checkins")
      .eq("organizer_id", uid);
    const nextMap: Record<string, MetricRow> = {};
    for (const row of (metricData as MetricRow[] | null) ?? []) {
      nextMap[row.event_id] = row;
    }
    setMetrics(nextMap);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        void loadData(uid);
      }
    });
  }, [client, loadData]);

  const requestVerification = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !userId) return;
    const { error } = await client.from("organizer_verification_requests").insert({
      user_id: userId,
      organization_name: orgName,
      organization_email: orgEmail,
      website_url: orgWebsite || null,
    });
    setMessage(error ? `Error: ${error.message}` : "Verification request submitted.");
  };

  const createEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !userId) return;
    const { error } = await client.from("events").insert({
      created_by: userId,
      title: newEvent.title,
      venue: newEvent.venue || null,
      time_label: newEvent.timeLabel || null,
      category: newEvent.category,
      source_url: newEvent.sourceUrl || `https://haps.app/events/${crypto.randomUUID()}`,
      location: newEvent.location,
      start_at: newEvent.startAt || null,
      end_at: newEvent.endAt || null,
      spontaneity_score: 70,
      crowd_label: "moderate",
      tags: parseTags(newEvent.tags),
    });
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage("Event created.");
    setNewEvent({
      title: "",
      venue: "",
      timeLabel: "",
      category: "social",
      sourceUrl: "",
      location: "-37.8136,144.9631",
      startAt: "",
      endAt: "",
      tags: "",
    });
    await loadData(userId);
  };

  const startEditing = (eventRow: EventRow) => {
    setEditingEventId(eventRow.id);
    setEditEvent({
      title: eventRow.title,
      venue: eventRow.venue ?? "",
      timeLabel: eventRow.time_label ?? "",
      category: eventRow.category ?? "social",
      sourceUrl: eventRow.source_url ?? "",
      location: eventRow.location ?? "",
      startAt: eventRow.start_at ? eventRow.start_at.slice(0, 16) : "",
      endAt: eventRow.end_at ? eventRow.end_at.slice(0, 16) : "",
      tags: (eventRow.tags ?? []).join(", "),
    });
  };

  const saveEdit = async (eventId: string) => {
    if (!client || !userId) return;
    const { error } = await client
      .from("events")
      .update({
        title: editEvent.title,
        venue: editEvent.venue || null,
        time_label: editEvent.timeLabel || null,
        category: editEvent.category,
        source_url: editEvent.sourceUrl || null,
        location: editEvent.location || null,
        start_at: editEvent.startAt || null,
        end_at: editEvent.endAt || null,
        tags: parseTags(editEvent.tags),
      })
      .eq("id", eventId)
      .eq("created_by", userId);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setEditingEventId(null);
    setMessage("Event updated.");
    await loadData(userId);
  };

  const removeEvent = async (eventId: string) => {
    if (!client || !userId) return;
    const { error } = await client.from("events").delete().eq("id", eventId).eq("created_by", userId);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    await loadData(userId);
  };

  if (!isOrganizer) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-zinc-900">Organizer Access</h1>
            <Link href="/" className="text-sm text-zinc-700 underline">
              Back to map
            </Link>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            You are not verified yet. Submit verification details below.
          </p>
          <form onSubmit={requestVerification} className="mt-4 space-y-3">
            <input
              required
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              placeholder="Organization name"
              className="w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
            <input
              required
              type="email"
              value={orgEmail}
              onChange={(event) => setOrgEmail(event.target.value)}
              placeholder="Organization email"
              className="w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
            <input
              value={orgWebsite}
              onChange={(event) => setOrgWebsite(event.target.value)}
              placeholder="Website URL (optional)"
              className="w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
            <button type="submit" className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-900 hover:bg-amber-300">
              Request verification
            </button>
            {message ? <p className="text-sm text-zinc-700">{message}</p> : null}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Organizer Dashboard</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-600">Create and manage events, then monitor engagement.</p>

        <form onSubmit={createEvent} className="mt-4 grid gap-2 md:grid-cols-2">
          <input
            required
            value={newEvent.title}
            onChange={(event) => setNewEvent((current) => ({ ...current, title: event.target.value }))}
            placeholder="Event title"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.venue}
            onChange={(event) => setNewEvent((current) => ({ ...current, venue: event.target.value }))}
            placeholder="Venue"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.timeLabel}
            onChange={(event) => setNewEvent((current) => ({ ...current, timeLabel: event.target.value }))}
            placeholder="Time label"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.category}
            onChange={(event) => setNewEvent((current) => ({ ...current, category: event.target.value }))}
            placeholder="Category"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.sourceUrl}
            onChange={(event) => setNewEvent((current) => ({ ...current, sourceUrl: event.target.value }))}
            placeholder="Source URL"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.location}
            onChange={(event) => setNewEvent((current) => ({ ...current, location: event.target.value }))}
            placeholder="Lat,Lng"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            type="datetime-local"
            value={newEvent.startAt}
            onChange={(event) => setNewEvent((current) => ({ ...current, startAt: event.target.value }))}
            placeholder="Start time"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            type="datetime-local"
            value={newEvent.endAt}
            onChange={(event) => setNewEvent((current) => ({ ...current, endAt: event.target.value }))}
            placeholder="End time"
            className="rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            value={newEvent.tags}
            onChange={(event) => setNewEvent((current) => ({ ...current, tags: event.target.value }))}
            placeholder="Tags (comma separated)"
            className="rounded-xl border border-zinc-300 px-3 py-2 md:col-span-2"
          />
          <button type="submit" className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-900 hover:bg-amber-300 md:col-span-2">
            Create event
          </button>
        </form>

        {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}

        <div className="mt-5 space-y-2">
          {events.map((eventRow) => {
            const metric = metrics[eventRow.id];
            return (
              <article key={eventRow.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="font-semibold text-zinc-900">{eventRow.title}</p>
                <p className="text-sm text-zinc-600">
                  {eventRow.venue ?? "Venue TBA"} | {eventRow.time_label ?? "Time TBA"} | {eventRow.category ?? "social"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Tags: {(eventRow.tags ?? []).length > 0 ? (eventRow.tags ?? []).join(", ") : "none"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Views: {metric?.view_count ?? 0} | Interested: {metric?.interested_count ?? 0} | Going:{" "}
                  {metric?.going_count ?? 0} | Check-ins: {metric?.active_checkins ?? 0}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEditing(eventRow)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEvent(eventRow.id)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Delete
                  </button>
                </div>
                {editingEventId === eventRow.id ? (
                  <div className="mt-3 grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-2">
                    <input
                      value={editEvent.title}
                      onChange={(event) => setEditEvent((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Event title"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.venue}
                      onChange={(event) => setEditEvent((current) => ({ ...current, venue: event.target.value }))}
                      placeholder="Venue"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.timeLabel}
                      onChange={(event) => setEditEvent((current) => ({ ...current, timeLabel: event.target.value }))}
                      placeholder="Time label"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.category}
                      onChange={(event) => setEditEvent((current) => ({ ...current, category: event.target.value }))}
                      placeholder="Category"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.sourceUrl}
                      onChange={(event) => setEditEvent((current) => ({ ...current, sourceUrl: event.target.value }))}
                      placeholder="Source URL"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.location}
                      onChange={(event) => setEditEvent((current) => ({ ...current, location: event.target.value }))}
                      placeholder="Lat,Lng"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      type="datetime-local"
                      value={editEvent.startAt}
                      onChange={(event) => setEditEvent((current) => ({ ...current, startAt: event.target.value }))}
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      type="datetime-local"
                      value={editEvent.endAt}
                      onChange={(event) => setEditEvent((current) => ({ ...current, endAt: event.target.value }))}
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={editEvent.tags}
                      onChange={(event) => setEditEvent((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="Tags (comma separated)"
                      className="rounded-xl border border-zinc-300 px-3 py-2 md:col-span-2"
                    />
                    <div className="flex gap-2 md:col-span-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(eventRow.id)}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingEventId(null)}
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {events.length === 0 ? <p className="text-sm text-zinc-600">No organizer events yet.</p> : null}
        </div>
      </div>
    </main>
  );
}

export default function OrganizerPage() {
  return (
    <AuthGate>
      <OrganizerInner />
    </AuthGate>
  );
}
