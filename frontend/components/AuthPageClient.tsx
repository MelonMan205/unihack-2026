"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type AuthMode = "sign-in" | "sign-up";

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Authentication failed. Please try again.";
}

function buildAuthRedirect(nextPath?: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const configuredBase = process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL?.trim();
  const base = configuredBase ? configuredBase.replace(/\/+$/, "") : window.location.origin;
  const nextQuery = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  return `${base}/auth${nextQuery}`;
}

export function AuthPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = useMemo(() => params.get("next") || "/", [params]);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [isPending, setIsPending] = useState(false);

  const client = getSupabaseBrowserClient();

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        return;
      }
      const { data: profile } = await client
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.onboarding_completed) {
        router.replace(nextPath);
      } else {
        router.replace("/onboarding");
      }
    });
  }, [client, nextPath, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText("");
    setSuccessText("");

    if (!client) {
      setErrorText("Missing Supabase environment variables.");
      return;
    }

    setIsPending(true);
    try {
      if (mode === "sign-up") {
        const emailRedirectTo = buildAuthRedirect(nextPath);
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo,
            data: {
              name: username.trim(),
              full_name: username.trim(),
            },
          },
        });
        if (error) throw error;

        if (data.user && !data.session) {
          setSuccessText("Check your email to verify your account, then sign in.");
          return;
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      const { data: userData } = await client.auth.getUser();
      if (!userData.user) {
        router.replace(`/auth?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      const { data: profile } = await client
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (!profile?.onboarding_completed) {
        router.replace("/onboarding");
      } else {
        router.replace(nextPath);
      }
    } catch (error) {
      setErrorText(toMessage(error));
    } finally {
      setIsPending(false);
    }
  };

  const onOAuth = async (provider: "google" | "apple") => {
    setErrorText("");
    setSuccessText("");
    if (!client) {
      setErrorText("Missing Supabase environment variables.");
      return;
    }

    const redirectTo = buildAuthRedirect(nextPath);
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) {
      setErrorText(toMessage(error));
    }
  };

  const onResetPassword = async () => {
    setErrorText("");
    setSuccessText("");
    if (!client) {
      setErrorText("Missing Supabase environment variables.");
      return;
    }
    if (!email.trim()) {
      setErrorText("Enter your email first, then press reset password.");
      return;
    }
    const redirectTo = buildAuthRedirect();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      setErrorText(toMessage(error));
      return;
    }
    setSuccessText("Password reset email sent. Check your inbox.");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-8">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-zinc-900">Happs account</h1>
        <p className="mt-1 text-sm text-zinc-600">Sign in or create an account to unlock social features.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("sign-in")}
            className={`rounded-xl border px-3 py-2 text-sm ${mode === "sign-in" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className={`rounded-xl border px-3 py-2 text-sm ${mode === "sign-up" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          {mode === "sign-up" ? (
            <label className="block text-sm text-zinc-700">
              Username
              <input
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
              />
            </label>
          ) : null}

          <label className="block text-sm text-zinc-700">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-zinc-700">
            Password
            <input
              required
              type="password"
              minLength={8}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-xl bg-amber-400 px-4 py-2.5 font-semibold text-zinc-900 hover:bg-amber-300 disabled:cursor-progress disabled:opacity-70"
          >
            {isPending ? "Working..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button type="button" onClick={onResetPassword} className="mt-3 text-sm text-zinc-600 underline">
          Reset password
        </button>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => void onOAuth("google")}
            className="w-full rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => void onOAuth("apple")}
            className="w-full rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
          >
            Continue with Apple
          </button>
        </div>

        {errorText ? <p className="mt-3 text-sm text-red-600">{errorText}</p> : null}
        {successText ? <p className="mt-3 text-sm text-green-700">{successText}</p> : null}
      </div>
    </main>
  );
}
