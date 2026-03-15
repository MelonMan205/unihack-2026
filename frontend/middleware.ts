import { NextResponse, type NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  // Supabase browser auth is currently client-managed, so server middleware
  // cannot reliably determine signed-in state without causing redirect loops.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|haps-logo.svg|manifest.webmanifest|api).*)"],
};
