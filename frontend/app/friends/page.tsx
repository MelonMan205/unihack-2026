"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Friendship = {
  id: string;
  status: string;
  is_incoming: boolean;
  other_user_id: string;
  other_username: string | null;
  other_display_name: string | null;
  is_close_friend: boolean;
};

type ProfileSearchResult = {
  id: string;
  username: string | null;
  display_name: string | null;
};

function FriendsInner() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string>("");
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadFriendships = useCallback(async (currentUserId: string) => {
    if (!client) return;
    const { data } = await client.rpc("app_list_friendships", { max_results: 120 });
    setFriendships((data as Friendship[] | null) ?? []);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      const currentUserId = data.session?.user?.id || "";
      setUserId(currentUserId);
      if (currentUserId) {
        void loadFriendships(currentUserId);
      }
    });
  }, [client, loadFriendships]);

  useEffect(() => {
    if (!client) return;
    const query = searchQuery.trim().toLowerCase();
    const safeQuery = query.replace(/^@+/, "").replace(/[%_\\]/g, "");
    if (safeQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      client
        .rpc("app_search_profiles", {
          search_text: safeQuery,
          max_results: 8,
        })
        .then(({ data, error: searchError }) => {
        if (isCancelled) {
          return;
        }

        if (searchError) {
          setError(searchError.message);
          setSearchResults([]);
          setIsSearching(false);
          return;
        }

        const merged = (data ?? []) as ProfileSearchResult[];
        const unique = new Map<string, ProfileSearchResult>();
        for (const profile of merged) {
          if (profile.id !== userId) {
            unique.set(profile.id, profile);
          }
        }

        setSearchResults(Array.from(unique.values()).slice(0, 8));
        setIsSearching(false);
      });
    }, 450);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
      setIsSearching(false);
    };
  }, [client, searchQuery, userId]);

  const sendRequest = async (targetId: string) => {
    if (!client) return;
    setError("");
    setMessage("");
    const { error: requestError } = await client.rpc("app_send_friend_request", {
      target_user_id: targetId,
    });
    if (requestError) {
      setError(requestError.message);
      return;
    }
    setMessage("Friend request sent.");
    setSearchQuery("");
    setSearchResults([]);
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

  const removeFriend = async (targetUserId: string) => {
    if (!client) return;
    setError("");
    setMessage("");
    const { error: removeError } = await client.rpc("app_remove_friend", {
      target_user_id: targetUserId,
    });
    if (removeError) {
      setError(removeError.message);
      return;
    }
    setMessage("Friend removed.");
    if (userId) {
      await loadFriendships(userId);
    }
  };

  const setCloseFriend = async (targetUserId: string, makeClose: boolean) => {
    if (!client) return;
    setError("");
    setMessage("");
    const { error: closeFriendError } = await client.rpc("app_set_close_friend", {
      target_user_id: targetUserId,
      make_close: makeClose,
    });
    if (closeFriendError) {
      setError(closeFriendError.message);
      return;
    }
    setMessage(makeClose ? "Added to close friends." : "Removed from close friends.");
    if (userId) {
      await loadFriendships(userId);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Friends</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-600">Send requests, accept invites, and manage your social network.</p>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Add friend</p>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by username"
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2"
          />
          <p className="mt-1 text-[11px] text-zinc-500">Type at least 3 characters. Prefix search only.</p>
          <div className="mt-2 space-y-2">
            {isSearching ? <p className="text-xs text-zinc-500">Searching...</p> : null}
            {!isSearching && searchQuery.trim().length >= 3 && searchResults.length === 0 ? (
              <p className="text-xs text-zinc-500">No matching users found.</p>
            ) : null}
            {searchResults.map((profile) => (
              <div key={profile.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {profile.display_name?.trim() || profile.username || "Unnamed user"}
                  </p>
                  <p className="text-xs text-zinc-600">@{profile.username || "no-username"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void sendRequest(profile.id)}
                  className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-300"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
        {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 space-y-2">
          {friendships.map((friendship) => {
            const preferredName =
              friendship.other_display_name?.trim() || friendship.other_username?.trim() || "Unknown user";
            const usernameHandle = friendship.other_username?.trim() ? `@${friendship.other_username.trim()}` : "@unknown";
            return (
              <div key={friendship.id} className="rounded-xl border border-zinc-200 p-3">
                <p className="text-sm font-medium text-zinc-800">{preferredName}</p>
                <p className="text-xs text-zinc-600">{usernameHandle}</p>
                <p className="text-xs text-zinc-600">Status: {friendship.status}</p>
                {friendship.status === "accepted" ? (
                  <p className="text-xs text-zinc-600">
                    Close friend: {friendship.is_close_friend ? "yes" : "no"}
                  </p>
                ) : null}
                {friendship.is_incoming && friendship.status === "pending" ? (
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
                {friendship.status === "accepted" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void setCloseFriend(friendship.other_user_id, !friendship.is_close_friend)
                      }
                      className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
                    >
                      {friendship.is_close_friend ? "Remove Close Friend" : "Make Close Friend"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFriend(friendship.other_user_id)}
                      className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700"
                    >
                      Remove Friend
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
