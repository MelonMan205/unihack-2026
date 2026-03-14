"use client";

import { useCallback, useEffect, useState } from "react";
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

function AdminInner() {
  const client = getSupabaseBrowserClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [message, setMessage] = useState("");

  const loadData = useCallback(async (uid: string) => {
    if (!client) return;
    const admin = await isAdminUser(client, uid);
    setIsAdmin(admin);
    if (!admin) return;

    const [{ data: reqData }, { data: reportData }] = await Promise.all([
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
    ]);

    setRequests((reqData as VerificationRequest[] | null) ?? []);
    setReports((reportData as ReportRow[] | null) ?? []);
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
          <h1 className="text-2xl font-bold text-zinc-900">Admin</h1>
          <p className="mt-2 text-sm text-zinc-600">You do not have admin access.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">Admin Moderation</h1>
        {message ? <p className="mt-2 text-sm text-zinc-700">{message}</p> : null}

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
