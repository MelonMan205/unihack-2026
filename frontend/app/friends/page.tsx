"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
};

function FriendsInner() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string>("");
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [error, setError] = useState("");

  const loadFriendships = useCallback(async (currentUserId: string) => {
    if (!client) return;
    const { data } = await client
      .from("friendships")
      .select("id,requester_id,addressee_id,status")
      .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`)
      .order("updated_at", { ascending: false });
    setFriendships((data as Friendship[] | null) ?? []);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(({ data }) => {
      const currentUserId = data.user?.id || "";
      setUserId(currentUserId);
      if (currentUserId) {
        void loadFriendships(currentUserId);
      }
    });
  }, [client, loadFriendships]);

  const sendRequest = async () => {
    if (!client) return;
    setError("");
    const { error: requestError } = await client.rpc("app_send_friend_request", {
      target_user_id: targetUserId,
    });
    if (requestError) {
      setError(requestError.message);
      return;
    }
    setTargetUserId("");
    if (userId) {
      await loadFriendships(userId);
    }
  };

  const respond = async (friendshipId: string, decision: "accepted" | "declined") => {
    if (!client) return;
    const { error: respondError } = await client.rpc("app_respond_friend_request", {
      friendship_id: friendshipId,
      decision,
    });
    if (respondError) {
      setError(respondError.message);
      return;
    }
    if (userId) {
      await loadFriendships(userId);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">Friends</h1>
        <p className="mt-1 text-sm text-zinc-600">Send requests, accept invites, and manage your social network.</p>

        <div className="mt-4 flex gap-2">
          <input
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
            placeholder="Target user UUID"
            className="flex-1 rounded-xl border border-zinc-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={() => void sendRequest()}
            className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-900 hover:bg-amber-300"
          >
            Send request
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 space-y-2">
          {friendships.map((friendship) => {
            const isIncoming = friendship.addressee_id === userId && friendship.status === "pending";
            const otherUserId = friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id;
            return (
              <div key={friendship.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="text-sm text-zinc-800">User: {otherUserId}</p>
                <p className="text-xs text-zinc-600">Status: {friendship.status}</p>
                {isIncoming ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void respond(friendship.id, "accepted")}
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void respond(friendship.id, "declined")}
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {friendships.length === 0 ? <p className="text-sm text-zinc-600">No friendships yet.</p> : null}
        </div>
      </div>
    </main>
  );
}

export default function FriendsPage() {
  return (
    <AuthGate>
      <FriendsInner />
    </AuthGate>
  );
}
