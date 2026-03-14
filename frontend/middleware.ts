import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/onboarding",
  "/profile",
  "/friends",
  "/saved",
  "/notifications",
  "/organizer",
  "/admin",
];

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  if (hasSupabaseSessionCookie(request)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/auth";
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|haps-logo.svg|api).*)"],
};
