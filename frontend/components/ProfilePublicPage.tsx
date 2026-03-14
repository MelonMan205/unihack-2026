"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  interests: string[] | null;
  attended_total_count: number;
  attended_month_count: number;
};

function ProfilePublicInner({ username }: { username: string }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    client
      .from("profiles")
      .select("id,username,display_name,bio,interests,attended_total_count,attended_month_count")
      .eq("username", username)
      .maybeSingle()
      .then(({ data }) => {
        setProfile((data as ProfileRow | null) ?? null);
        setIsLoading(false);
      });
  }, [username]);

  if (isLoading) {
    return <p className="p-4 text-sm text-zinc-600">Loading profile...</p>;
  }

  if (!profile) {
    return <p className="p-4 text-sm text-zinc-600">Profile not found.</p>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h1 className="text-2xl font-bold text-zinc-900">{profile.display_name ?? profile.username}</h1>
        <p className="mt-2 text-sm text-zinc-600">{profile.bio?.trim() || "No bio yet."}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(profile.interests ?? []).map((interest) => (
            <span key={interest} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
              {interest}
            </span>
          ))}
        </div>
        <div className="mt-5 text-sm text-zinc-700">
          <p>Total attended: {profile.attended_total_count ?? 0}</p>
          <p>Attended this month: {profile.attended_month_count ?? 0}</p>
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-zinc-700 underline">
          Back to map
        </Link>
      </div>
    </main>
  );
}

export function ProfilePublicPage({ username }: { username: string }) {
  return (
    <AuthGate>
      <ProfilePublicInner username={username} />
    </AuthGate>
  );
}
