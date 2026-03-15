"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isAdminUser } from "@/lib/roles";

type VerificationRequest = {
  id: string;
  user_id: string;
  organization_name: string;
  organization_email: string;
  status: string;
};

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_user_id: string | null;
  target_event_id: string | null;
  reason: string;
  status: string;
};

type AdminEventRow = {
  id: string;
  title: string;
  venue: string | null;
  time_label: string | null;
  category: string | null;
  source_url: string | null;
  photo_url: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  recurrence_cadence: "none" | "daily" | "weekly" | "monthly";
  recurrence_weekdays: number[] | null;
  recurrence_until: string | null;
  tags: string[] | null;
  is_hidden: boolean;
  created_by: string | null;
};

type EventDraft = {
  title: string;
  venue: string;
  timeLabel: string;
  category: string;
  sourceUrl: string;
  photoUrl: string;
  location: string;
  startAt: string;
  endAt: string;
  recurrenceCadence: "none" | "daily" | "weekly" | "monthly";
  recurrenceWeekdays: number[];
  recurrenceUntil: string;
  tags: string;
};

const WEEKDAY_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function validateEventDraft(draft: EventDraft): string | null {
  if (!draft.title.trim()) return "Event title is required.";
  if (!draft.startAt) return "Start time is required.";
  if (draft.endAt && new Date(draft.endAt).getTime() <= new Date(draft.startAt).getTime()) {
    return "End time must be after start time.";
  }
  if (draft.recurrenceCadence === "weekly" && draft.recurrenceWeekdays.length === 0) {
    return "Select at least one weekday for weekly repeats.";
  }
  if (draft.recurrenceUntil && new Date(draft.recurrenceUntil).getTime() < new Date(draft.startAt).getTime()) {
    return "Repeat-until date must be after the event start.";
  }
  return null;
}

function AdminInner() {
  const client = getSupabaseBrowserClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [message, setMessage] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    title: "",
    venue: "",
    timeLabel: "",
    category: "social",
    sourceUrl: "",
    photoUrl: "",
    location: "",
    startAt: "",
    endAt: "",
    recurrenceCadence: "none",
    recurrenceWeekdays: [],
    recurrenceUntil: "",
    tags: "",
  });

  const loadData = useCallback(async (uid: string) => {
    if (!client) return;
    const admin = await isAdminUser(client, uid);
    setIsAdmin(admin);
    if (!admin) return;

    const [{ data: reqData }, { data: reportData }, { data: eventData }] = await Promise.all([
      client
        .from("organizer_verification_requests")
        .select("id,user_id,organization_name,organization_email,status")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      client
        .from("reports")
        .select("id,reporter_id,target_type,target_user_id,target_event_id,reason,status")
        .in("status", ["open", "reviewing"])
        .order("created_at", { ascending: true }),
      client
        .from("events")
        .select("id,title,venue,time_label,category,source_url,photo_url,location,start_at,end_at,recurrence_cadence,recurrence_weekdays,recurrence_until,tags,is_hidden,created_by")
        .order("created_at", { ascending: false })
        .limit(150),
    ]);

    setRequests((reqData as VerificationRequest[] | null) ?? []);
    setReports((reportData as ReportRow[] | null) ?? []);
    setEvents((eventData as AdminEventRow[] | null) ?? []);
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

  const reviewRequest = async (requestId: string, approved: boolean) => {
    if (!client || !userId) return;
    const { error } = await client.rpc("app_admin_review_organizer_request", {
      request_id: requestId,
      approved,
      review_notes: approved ? "Approved by admin dashboard." : "Rejected by admin dashboard.",
    });
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage("Request updated.");
    await loadData(userId);
  };

  const resolveReport = async (reportId: string) => {
    if (!client || !userId) return;
    const { error } = await client
      .from("reports")
      .update({ status: "resolved", assigned_admin_id: userId, resolved_at: new Date().toISOString() })
      .eq("id", reportId);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    await client.from("moderation_actions").insert({
      admin_id: userId,
      report_id: reportId,
      action_type: "edit_event",
      notes: "Resolved via admin dashboard.",
    });
    setMessage("Report resolved.");
    await loadData(userId);
  };

  const beginEdit = (eventRow: AdminEventRow) => {
    setEditingEventId(eventRow.id);
    setEventDraft({
      title: eventRow.title,
      venue: eventRow.venue ?? "",
      timeLabel: eventRow.time_label ?? "",
      category: eventRow.category ?? "social",
      sourceUrl: eventRow.source_url ?? "",
      photoUrl: eventRow.photo_url ?? "",
      location: eventRow.location ?? "",
      startAt: eventRow.start_at ? eventRow.start_at.slice(0, 16) : "",
      endAt: eventRow.end_at ? eventRow.end_at.slice(0, 16) : "",
      recurrenceCadence: eventRow.recurrence_cadence ?? "none",
      recurrenceWeekdays: eventRow.recurrence_weekdays ?? [],
      recurrenceUntil: eventRow.recurrence_until ? eventRow.recurrence_until.slice(0, 16) : "",
      tags: (eventRow.tags ?? []).join(", "),
    });
  };

  const saveEventEdit = async (eventId: string) => {
    if (!client || !userId) return;
    const validationError = validateEventDraft(eventDraft);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const startAtIso = new Date(eventDraft.startAt).toISOString();
    const endAtIso = eventDraft.endAt ? new Date(eventDraft.endAt).toISOString() : null;
    const recurrenceUntilIso = eventDraft.recurrenceUntil ? new Date(eventDraft.recurrenceUntil).toISOString() : null;
    const existingEvent = events.find((row) => row.id === eventId);
    if (existingEvent?.created_by) {
      const duplicateCheck = await client
        .from("events")
        .select("id,title,location,created_by")
        .eq("created_by", existingEvent.created_by)
        .eq("start_at", startAtIso)
        .neq("id", eventId)
        .limit(30);
      if (duplicateCheck.error) {
        setMessage(`Error: ${duplicateCheck.error.message}`);
        return;
      }
      const duplicateFound = (duplicateCheck.data ?? []).some((row) => {
        const rowTitle = normalizeText(row.title ?? "");
        const rowLocation = normalizeText(row.location ?? "");
        return rowTitle === normalizeText(eventDraft.title) && rowLocation === normalizeText(eventDraft.location);
      });
      if (duplicateFound) {
        setMessage("Duplicate event detected for same title, location, and start time.");
        return;
      }
    }
    const { error } = await client
      .from("events")
      .update({
        title: eventDraft.title.trim(),
        venue: eventDraft.venue || null,
        time_label: eventDraft.timeLabel || null,
        category: eventDraft.category,
        source_url: eventDraft.sourceUrl || null,
        photo_url: eventDraft.photoUrl || null,
        location: eventDraft.location.trim() || null,
        start_at: startAtIso,
        end_at: endAtIso,
        recurrence_cadence: eventDraft.recurrenceCadence,
        recurrence_weekdays: eventDraft.recurrenceCadence === "weekly" ? eventDraft.recurrenceWeekdays : null,
        recurrence_until: recurrenceUntilIso,
        tags: parseTags(eventDraft.tags),
      })
      .eq("id", eventId);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    await client.from("moderation_actions").insert({
      admin_id: userId,
      action_type: "edit_event",
      target_event_id: eventId,
      notes: "Event updated from admin dashboard.",
    });
    setEditingEventId(null);
    setMessage("Event updated.");
    await loadData(userId);
  };

  const toggleHidden = async (eventRow: AdminEventRow) => {
    if (!client || !userId) return;
    const nextHidden = !eventRow.is_hidden;
    const { error } = await client.from("events").update({ is_hidden: nextHidden }).eq("id", eventRow.id);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    await client.from("moderation_actions").insert({
      admin_id: userId,
      action_type: nextHidden ? "remove_event" : "restore_event",
      target_event_id: eventRow.id,
      notes: nextHidden ? "Event hidden from public feeds." : "Event restored to public feeds.",
    });
    setMessage(nextHidden ? "Event hidden." : "Event restored.");
    await loadData(userId);
  };

  const deleteEvent = async (eventRow: AdminEventRow) => {
    if (!client || !userId) return;
    await client.from("moderation_actions").insert({
      admin_id: userId,
      action_type: "remove_event",
      target_event_id: eventRow.id,
      notes: "Event hard-deleted from admin dashboard.",
    });
    const { error } = await client.from("events").delete().eq("id", eventRow.id);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    if (editingEventId === eventRow.id) {
      setEditingEventId(null);
    }
    setMessage("Event deleted.");
    await loadData(userId);
  };

  const banUser = async (targetUserId: string | null) => {
    if (!client || !userId || !targetUserId) return;
    const { error } = await client.from("user_bans").insert({
      user_id: targetUserId,
      reason: "Banned by moderator due to report review.",
      banned_by: userId,
      is_active: true,
    });
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage("User banned.");
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-zinc-900">Admin</h1>
            <Link href="/" className="text-sm text-zinc-700 underline">
              Back to map
            </Link>
          </div>
          <p className="mt-2 text-sm text-zinc-600">You do not have admin access.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Admin Moderation</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
        {message ? <p className="mt-2 text-sm text-zinc-700">{message}</p> : null}

        <section className="mt-5">
          <h2 className="text-lg font-semibold text-zinc-900">Event moderation</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Review organizer and scraped events, edit details, hide/unhide from public map, or hard delete.
          </p>
          <div className="mt-2 space-y-2">
            {events.map((eventRow) => (
              <article key={eventRow.id} className="rounded-xl border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-zinc-900">{eventRow.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      eventRow.is_hidden ? "bg-zinc-200 text-zinc-700" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {eventRow.is_hidden ? "Hidden" : "Visible"}
                  </span>
                </div>
                <p className="text-sm text-zinc-600">
                  {eventRow.venue ?? "Venue TBA"} | {eventRow.time_label ?? "Time TBA"} | {eventRow.category ?? "social"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Creator: {eventRow.created_by ?? "unknown"} | Tags:{" "}
                  {(eventRow.tags ?? []).length > 0 ? (eventRow.tags ?? []).join(", ") : "none"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => beginEdit(eventRow)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleHidden(eventRow)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    {eventRow.is_hidden ? "Unhide" : "Hide"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteEvent(eventRow)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Delete
                  </button>
                </div>
                {editingEventId === eventRow.id ? (
                  <div className="mt-3 grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-2">
                    <input
                      value={eventDraft.title}
                      onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Event title"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.venue}
                      onChange={(event) => setEventDraft((current) => ({ ...current, venue: event.target.value }))}
                      placeholder="Venue"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.timeLabel}
                      onChange={(event) => setEventDraft((current) => ({ ...current, timeLabel: event.target.value }))}
                      placeholder="Time label"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.category}
                      onChange={(event) => setEventDraft((current) => ({ ...current, category: event.target.value }))}
                      placeholder="Category"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.sourceUrl}
                      onChange={(event) => setEventDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                      placeholder="Source URL"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.photoUrl}
                      onChange={(event) => setEventDraft((current) => ({ ...current, photoUrl: event.target.value }))}
                      placeholder="Image URL"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      value={eventDraft.location}
                      onChange={(event) => setEventDraft((current) => ({ ...current, location: event.target.value }))}
                      placeholder="Lat,Lng"
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      type="datetime-local"
                      value={eventDraft.startAt}
                      onChange={(event) => setEventDraft((current) => ({ ...current, startAt: event.target.value }))}
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <input
                      type="datetime-local"
                      value={eventDraft.endAt}
                      onChange={(event) => setEventDraft((current) => ({ ...current, endAt: event.target.value }))}
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    <select
                      value={eventDraft.recurrenceCadence}
                      onChange={(event) =>
                        setEventDraft((current) => ({
                          ...current,
                          recurrenceCadence: event.target.value as EventDraft["recurrenceCadence"],
                          recurrenceWeekdays: event.target.value === "weekly" ? current.recurrenceWeekdays : [],
                        }))
                      }
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Repeats daily</option>
                      <option value="weekly">Repeats weekly</option>
                      <option value="monthly">Repeats monthly</option>
                    </select>
                    <input
                      type="datetime-local"
                      value={eventDraft.recurrenceUntil}
                      onChange={(event) => setEventDraft((current) => ({ ...current, recurrenceUntil: event.target.value }))}
                      className="rounded-xl border border-zinc-300 px-3 py-2"
                    />
                    {eventDraft.recurrenceCadence === "weekly" ? (
                      <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-300 px-3 py-2 md:col-span-2">
                        {WEEKDAY_OPTIONS.map((weekday) => (
                          <label key={weekday.value} className="inline-flex items-center gap-1 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={eventDraft.recurrenceWeekdays.includes(weekday.value)}
                              onChange={(event) =>
                                setEventDraft((current) => ({
                                  ...current,
                                  recurrenceWeekdays: event.target.checked
                                    ? [...current.recurrenceWeekdays, weekday.value].sort((a, b) => a - b)
                                    : current.recurrenceWeekdays.filter((value) => value !== weekday.value),
                                }))
                              }
                            />
                            {weekday.label}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <input
                      value={eventDraft.tags}
                      onChange={(event) => setEventDraft((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="Tags (comma separated)"
                      className="rounded-xl border border-zinc-300 px-3 py-2 md:col-span-2"
                    />
                    <div className="flex gap-2 md:col-span-2">
                      <button
                        type="button"
                        onClick={() => void saveEventEdit(eventRow.id)}
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
            ))}
            {events.length === 0 ? <p className="text-sm text-zinc-600">No events to moderate yet.</p> : null}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-lg font-semibold text-zinc-900">Organizer verification requests</h2>
          <div className="mt-2 space-y-2">
            {requests.map((requestRow) => (
              <article key={requestRow.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="font-semibold text-zinc-900">{requestRow.organization_name}</p>
                <p className="text-sm text-zinc-600">
                  {requestRow.organization_email} | User: {requestRow.user_id}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void reviewRequest(requestRow.id, true)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewRequest(requestRow.id, false)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
            {requests.length === 0 ? <p className="text-sm text-zinc-600">No pending organizer requests.</p> : null}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-900">Open reports</h2>
          <div className="mt-2 space-y-2">
            {reports.map((report) => (
              <article key={report.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="font-semibold text-zinc-900">
                  {report.target_type === "event" ? `Event report (${report.target_event_id})` : `User report (${report.target_user_id})`}
                </p>
                <p className="text-sm text-zinc-600">{report.reason}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void resolveReport(report.id)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                  >
                    Resolve
                  </button>
                  {report.target_user_id ? (
                    <button
                      type="button"
                      onClick={() => void banUser(report.target_user_id)}
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                    >
                      Ban user
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {reports.length === 0 ? <p className="text-sm text-zinc-600">No open reports.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AdminInner />
    </AuthGate>
  );
}
