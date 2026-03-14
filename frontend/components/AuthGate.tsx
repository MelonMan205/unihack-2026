"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
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

    let isDisposed = false;
    const validateSession = async (session: Session | null) => {
      if (isDisposed) {
        return;
      }
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (!nextUser) {
        setState("loading");
        router.replace(`/auth?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }

      if (requireOnboarding) {
        const { data: profile, error } = await client
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", nextUser.id)
          .maybeSingle();

        if (isDisposed) {
          return;
        }
        if (error) {
          // Avoid trapping users in a permanent loading state if profile lookup fails.
          setState("ready");
          return;
        }
        if (!profile?.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }
      }

      setState("ready");
    };

    client.auth
      .getSession()
      .then(({ data }) => validateSession(data.session))
      .catch(() => {
        router.replace("/auth");
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      void validateSession(session);
    });

    return () => {
      isDisposed = true;
      subscription.unsubscribe();
    };
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
