import { Suspense } from "react";
import { AuthPageClient } from "@/components/AuthPageClient";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-zinc-600">Loading auth...</main>}>
      <AuthPageClient />
    </Suspense>
  );
}
