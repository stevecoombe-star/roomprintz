import { NextRequest, NextResponse } from "next/server";

const LOGIN_PATH = "/login";
const PROTECTED_PREFIXES = ["/editor", "/my-rooms", "/my-furniture", "/billing", "/app"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function readAuthToken(req: NextRequest): string | null {
  for (const cookie of req.cookies.getAll()) {
    if (!cookie.name.startsWith("sb-")) continue;
    if (!cookie.name.endsWith("-auth-token")) continue;

    const raw = cookie.value?.trim();
    if (!raw) continue;

    if (raw.startsWith("base64-")) {
      const encoded = raw.slice("base64-".length);
      try {
        const decoded = atob(encoded);
        const parsed = JSON.parse(decoded) as { access_token?: unknown };
        if (typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
          return parsed.access_token;
        }
      } catch {
        continue;
      }
    }

    try {
      const parsed = JSON.parse(raw) as
        | { access_token?: unknown }
        | [{ access_token?: unknown }, unknown?];

      if (Array.isArray(parsed)) {
        const access = parsed[0]?.access_token;
        if (typeof access === "string" && access.length > 0) return access;
      } else if (typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
        return parsed.access_token;
      }
    } catch {
      // Ignore non-JSON cookie formats.
    }
  }

  return null;
}

function hasValidJwt(token: string | null): boolean {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const payloadPart = parts[1];
  const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const payloadText = atob(padded);
    const payload = JSON.parse(payloadText) as { exp?: unknown };
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!isProtectedPath(pathname)) return NextResponse.next();

  const token = readAuthToken(req);
  if (hasValidJwt(token)) return NextResponse.next();

  const loginUrl = new URL(LOGIN_PATH, req.url);
  const nextPath = `${pathname}${search}`;
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/editor/:path*", "/my-rooms/:path*", "/my-furniture/:path*", "/billing/:path*", "/app/:path*"],
};
