"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import {
  isMissingProfilesInterestsColumn,
  MISSING_PROFILES_INTERESTS_MESSAGE,
} from "@/lib/schema-errors";
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
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user;
      if (!sessionUser) {
        router.replace("/auth");
        return;
      }
      const { data: profileCore, error: profileCoreError } = await client
        .from("profiles")
        .select("onboarding_completed,username,avatar_url")
        .eq("id", sessionUser.id)
        .maybeSingle();
      if (profileCoreError) {
        setError(profileCoreError.message);
        return;
      }
      if (profileCore?.onboarding_completed) {
        router.replace("/");
        return;
      }
      setUsername(profileCore?.username ?? "");
      setAvatarUrl(profileCore?.avatar_url ?? "");

      const { data: interestData, error: interestsError } = await client
        .from("profiles")
        .select("interests")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (interestsError) {
        if (isMissingProfilesInterestsColumn(interestsError)) {
          setError(MISSING_PROFILES_INTERESTS_MESSAGE);
          return;
        }
        setError(interestsError.message);
        return;
      }

      if (Array.isArray(interestData?.interests) && interestData.interests.length > 0) {
        setSelected(interestData.interests.slice(0, 20));
      }
    });
  }, [client, router]);

  const canSubmit = useMemo(
    () => username.trim().length >= 3 && selected.length >= 3 && !isPending && !isUploadingAvatar,
    [username, selected.length, isPending, isUploadingAvatar],
  );

  const uploadAvatar = async (file: File) => {
    if (!client) return;
    setError("");
    setIsUploadingAvatar(true);
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setIsUploadingAvatar(false);
      setError("Session expired. Please sign in again.");
      return;
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "jpg";
    const filePath = `${user.id}/${crypto.randomUUID()}.${extension || "jpg"}`;
    const { error: uploadError } = await client.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (uploadError) {
      setIsUploadingAvatar(false);
      setError(`Avatar upload failed: ${uploadError.message}`);
      return;
    }
    const { data } = client.storage.from("avatars").getPublicUrl(filePath);
    setAvatarUrl(data.publicUrl);
    setIsUploadingAvatar(false);
  };

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
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      setError("Username must be 3-20 characters and use only letters, numbers, or underscores.");
      return;
    }

    if (selected.length < 3) {
      setError("Select at least 3 interests.");
      return;
    }

    setIsPending(true);
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setIsPending(false);
      setError("Session expired. Please sign in again.");
      router.replace("/auth");
      return;
    }

    const { error: updateError } = await client
      .from("profiles")
      .update({ username: normalizedUsername, avatar_url: avatarUrl || null, interests: selected, onboarding_completed: true })
      .eq("id", user.id);

    setIsPending(false);
    if (updateError) {
      if (isMissingProfilesInterestsColumn(updateError)) {
        setError(MISSING_PROFILES_INTERESTS_MESSAGE);
        return;
      }
      if (updateError.code === "23505") {
        setError("That username is already taken.");
        return;
      }
      setError(updateError.message);
      return;
    }
    router.replace("/");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-8">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">Set up your profile</h1>
          <Link href="/" className="text-sm text-zinc-700 underline">
            Back to map
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-600">Choose a username and at least 3 interests.</p>

        <label className="mt-4 block text-sm text-zinc-700">
          Profile image
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://..."
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          />
          <input
            type="file"
            accept="image/*"
            className="mt-2 block w-full text-xs text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void uploadAvatar(file);
            }}
          />
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt="Profile preview"
              width={64}
              height={64}
              unoptimized
              className="mt-2 h-16 w-16 rounded-full border border-zinc-200 object-cover"
            />
          ) : null}
          <span className="mt-1 block text-xs text-zinc-500">
            {isUploadingAvatar ? "Uploading image..." : "Optional. Add a URL or upload from your device."}
          </span>
        </label>

        <label className="mt-4 block text-sm text-zinc-700">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="your_name"
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-zinc-500">3-20 chars, letters/numbers/underscore.</span>
        </label>

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
