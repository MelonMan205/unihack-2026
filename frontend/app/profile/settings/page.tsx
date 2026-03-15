"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import {
  isMissingProfilesInterestsColumn,
  MISSING_PROFILES_INTERESTS_MESSAGE,
} from "@/lib/schema-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const CURATED_INTEREST_DEFAULTS = [
  "music",
  "nightlife",
  "sports",
  "food",
  "festivals",
  "comedy",
  "markets",
  "art",
  "technology",
  "networking",
  "outdoor",
  "fitness",
  "gaming",
];

function SettingsInner() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [privacyDefault, setPrivacyDefault] = useState("friends");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
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
        setSelectedInterests(Array.isArray(interestsData?.interests) ? interestsData.interests : []);
      }

      const { data: popularTagsData } = await client.rpc("app_list_popular_interest_tags", {
        max_results: 50,
      });
      const fromDb = Array.isArray(popularTagsData)
        ? popularTagsData
            .map((row) =>
              typeof row?.tag === "string" && row.tag.trim().length > 0 ? row.tag.trim().toLowerCase() : null,
            )
            .filter((value): value is string => Boolean(value))
        : [];
      const merged = Array.from(new Set([...fromDb, ...CURATED_INTEREST_DEFAULTS])).slice(0, 60);
      setSuggestedTags(merged);
    });
  }, [client]);

  const addInterest = (rawValue: string) => {
    const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, "_");
    if (!normalized) return;
    setSelectedInterests((current) =>
      current.includes(normalized) ? current : [...current, normalized].slice(0, 30),
    );
    setInterestInput("");
  };

  const removeInterest = (value: string) => {
    setSelectedInterests((current) => current.filter((item) => item !== value));
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!client || !userId) return;

    const { error } = await client
      .from("profiles")
      .update({
        username: username || null,
        display_name: displayName || null,
        bio: bio || null,
        privacy_default: privacyDefault,
        interests: selectedInterests,
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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Profile Settings</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
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
            </select>
          </label>
          <label className="block text-sm text-zinc-700">
            Interests
            <div className="mt-1 rounded-xl border border-zinc-300 bg-white p-3">
              <div className="mb-2 flex flex-wrap gap-2">
                {selectedInterests.map((interest) => (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => removeInterest(interest)}
                    className="rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs text-zinc-700 hover:border-zinc-400"
                    title="Remove interest"
                  >
                    {interest.replaceAll("_", " ")} ×
                  </button>
                ))}
                {selectedInterests.length === 0 ? (
                  <span className="text-xs text-zinc-500">No interests selected yet.</span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <input
                  value={interestInput}
                  onChange={(event) => setInterestInput(event.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2"
                  placeholder="Add custom interest"
                />
                <button
                  type="button"
                  onClick={() => addInterest(interestInput)}
                  className="rounded-xl border border-zinc-300 px-3 py-2 text-xs text-zinc-700"
                >
                  Add
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">Tap a suggested tag to add it quickly.</p>
              <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                {suggestedTags.map((tag) => {
                  const active = selectedInterests.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addInterest(tag)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active
                          ? "border-amber-500 bg-amber-100 text-amber-900"
                          : "border-zinc-300 bg-white text-zinc-700"
                      }`}
                    >
                      {tag.replaceAll("_", " ")}
                    </button>
                  );
                })}
              </div>
            </div>
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
