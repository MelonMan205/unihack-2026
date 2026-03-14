"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type AuthGateProps = {
  children: React.ReactNode;
  requireOnboarding?: boolean;
};

export function AuthGate({ children, requireOnboarding = true }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      router.replace("/auth");
      return;
    }

    client.auth
      .getUser()
      .then(async ({ data }) => {
        const nextUser = data.user ?? null;
        setUser(nextUser);
        if (!nextUser) {
          router.replace(`/auth?next=${encodeURIComponent(pathname || "/")}`);
          return;
        }

        if (requireOnboarding) {
          const { data: profile } = await client
            .from("profiles")
            .select("onboarding_completed")
            .eq("id", nextUser.id)
            .maybeSingle();

          if (!profile?.onboarding_completed) {
            router.replace("/onboarding");
            return;
          }
        }

        setState("ready");
      })
      .catch(() => {
        router.replace("/auth");
      });
  }, [pathname, requireOnboarding, router]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-600">
        Validating session...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
