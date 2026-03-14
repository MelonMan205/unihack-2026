"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const INTERESTS = [
  "music",
  "nightlife",
  "sports",
  "food",
  "festivals",
  "comedy",
  "markets",
  "art_and_culture",
  "university",
  "technology",
  "networking",
  "outdoor",
  "fitness",
  "gaming",
];

function OnboardingInner() {
  const router = useRouter();
  const client = getSupabaseBrowserClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/auth");
        return;
      }
      const { data: profile } = await client
        .from("profiles")
        .select("onboarding_completed,interests")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.onboarding_completed) {
        router.replace("/");
        return;
      }
      if (Array.isArray(profile?.interests) && profile.interests.length > 0) {
        setSelected(profile.interests.slice(0, 20));
      }
    });
  }, [client, router]);

  const canSubmit = useMemo(() => selected.length >= 3 && !isPending, [selected.length, isPending]);

  const toggleInterest = (value: string) => {
    setSelected((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const onComplete = async () => {
    setError("");
    if (!client) {
      setError("Missing Supabase configuration.");
      return;
    }
    if (selected.length < 3) {
      setError("Select at least 3 interests.");
      return;
    }

    setIsPending(true);
    const { data: userData } = await client.auth.getUser();
    const user = userData.user;
    if (!user) {
      setIsPending(false);
      setError("Session expired. Please sign in again.");
      router.replace("/auth");
      return;
    }

    const { error: updateError } = await client
      .from("profiles")
      .update({ interests: selected, onboarding_completed: true })
      .eq("id", user.id);

    setIsPending(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace("/");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-8">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-zinc-900">Choose your interests</h1>
        <p className="mt-1 text-sm text-zinc-600">Pick at least 3 so we can personalize your event map.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {INTERESTS.map((interest) => {
            const active = selected.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  active ? "border-amber-500 bg-amber-100 text-amber-900" : "border-zinc-300 bg-white text-zinc-700"
                }`}
              >
                {interest.replaceAll("_", " ")}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-sm text-zinc-600">{selected.length} selected (minimum 3)</p>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={() => void onComplete()}
          disabled={!canSubmit}
          className="mt-5 rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-zinc-900 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Continue"}
        </button>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGate requireOnboarding={false}>
      <OnboardingInner />
    </AuthGate>
  );
}
