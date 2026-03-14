"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import {
  isMissingProfilesInterestsColumn,
  MISSING_PROFILES_INTERESTS_MESSAGE,
} from "@/lib/schema-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase";

function SettingsInner() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [privacyDefault, setPrivacyDefault] = useState("friends");
  const [interestsCsv, setInterestsCsv] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(async ({ data }) => {
      const nextUserId = data.session?.user?.id ?? null;
      setUserId(nextUserId);
      if (!nextUserId) return;

      const { data: profile } = await client
        .from("profiles")
        .select("username,display_name,bio,privacy_default")
        .eq("id", nextUserId)
        .maybeSingle();
      if (!profile) return;

      setUsername(profile.username ?? "");
      setDisplayName(profile.display_name ?? "");
      setBio(profile.bio ?? "");
      setPrivacyDefault(profile.privacy_default ?? "friends");
      const { data: interestsData, error: interestsError } = await client
        .from("profiles")
        .select("interests")
        .eq("id", nextUserId)
        .maybeSingle();

      if (interestsError) {
        if (isMissingProfilesInterestsColumn(interestsError)) {
          setMessage(MISSING_PROFILES_INTERESTS_MESSAGE);
        } else {
          setMessage(`Error: ${interestsError.message}`);
        }
      } else {
        setInterestsCsv(Array.isArray(interestsData?.interests) ? interestsData.interests.join(", ") : "");
      }
    });
  }, [client]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!client || !userId) return;

    const interests = interestsCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const { error } = await client
      .from("profiles")
      .update({
        username: username || null,
        display_name: displayName || null,
        bio: bio || null,
        privacy_default: privacyDefault,
        interests,
      })
      .eq("id", userId);
    if (error) {
      if (isMissingProfilesInterestsColumn(error)) {
        setMessage(MISSING_PROFILES_INTERESTS_MESSAGE);
        return;
      }
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage("Profile updated.");
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">Profile Settings</h1>
        <form onSubmit={onSave} className="mt-4 space-y-3">
          <label className="block text-sm text-zinc-700">
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          </label>
          <label className="block text-sm text-zinc-700">
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          </label>
          <label className="block text-sm text-zinc-700">
            Bio
            <textarea value={bio} onChange={(event) => setBio(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          </label>
          <label className="block text-sm text-zinc-700">
            Privacy default
            <select value={privacyDefault} onChange={(event) => setPrivacyDefault(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2">
              <option value="public">Public</option>
              <option value="friends">Friends</option>
              <option value="close_friends">Close Friends</option>
              <option value="only_me">Only me</option>
              <option value="ghost">Ghost</option>
            </select>
          </label>
          <label className="block text-sm text-zinc-700">
            Interests (comma separated)
            <input
              value={interestsCsv}
              onChange={(event) => setInterestsCsv(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-900 hover:bg-amber-300">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              if (!client) return;
              void client.auth.signOut().then(() => {
                window.location.href = "/auth";
              });
            }}
            className="ml-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-700"
          >
            Sign out
          </button>
          {message ? <p className="text-sm text-zinc-700">{message}</p> : null}
        </form>
        <div className="mt-4 flex gap-3 text-sm">
          <Link href="/profile/analytics" className="text-zinc-700 underline">
            View analytics
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function ProfileSettingsPage() {
  return (
    <AuthGate>
      <SettingsInner />
    </AuthGate>
  );
}
