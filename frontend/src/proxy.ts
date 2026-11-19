import { NextResponse, type NextRequest } from "next/server";

/** Lists the accounts saved in this browser (backend/src/auth/session-cookie.ts). */
const SESSION_COOKIE = "cp_accounts";
const PUBLIC_PAGES = ["/login", "/register"];

/**
 * Optimistic check only: with no session cookie at all, skip rendering the app
 * and go straight to /login. It does not check that the cookie is valid —
 * the backend checks every request, and the app shell redirects on a 401.
 * Auth pages are never redirected, so an expired cookie can't cause a loop.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API rewrite, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
