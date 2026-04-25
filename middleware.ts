import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/adminAccess";

const LOGIN_PATH = "/login";
const ADMIN_PATH = "/admin";
const ADMIN_LOGIN_PATH = "/admin/login";
const PROTECTED_PREFIXES = ["/editor", "/my-rooms", "/my-furniture", "/billing", "/app"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function redirectToLogin(req: NextRequest, pathname: string, search: string): NextResponse {
  const loginUrl = new URL(LOGIN_PATH, req.url);
  const nextPath = `${pathname}${search}`;
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}

function redirectToAdminLogin(req: NextRequest, pathname: string, search: string): NextResponse {
  const adminLoginUrl = new URL(ADMIN_LOGIN_PATH, req.url);
  const nextPath = `${pathname}${search}`;
  if (nextPath !== ADMIN_LOGIN_PATH) {
    adminLoginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(adminLoginUrl);
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isAdminPath = pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);
  const isAdminLoginPath = pathname === ADMIN_LOGIN_PATH;
  const isRegularProtectedPath = isProtectedPath(pathname);

  if (!isAdminPath && !isRegularProtectedPath) return NextResponse.next();
  if (isAdminLoginPath) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isAdminPath) {
      return redirectToAdminLogin(req, pathname, search);
    }
    return redirectToLogin(req, pathname, search);
  }

  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          req.cookies.set(cookie.name, cookie.value);
        }
        response = NextResponse.next({ request: req });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    if (isAdminPath) {
      return redirectToAdminLogin(req, pathname, search);
    }
    return redirectToLogin(req, pathname, search);
  }

  if (isAdminPath && !isAdminEmail(user.email)) {
    return redirectToAdminLogin(req, pathname, search);
  }

  return response;
}

export const config = {
  matcher: [
    "/editor/:path*",
    "/my-rooms/:path*",
    "/my-furniture/:path*",
    "/billing/:path*",
    "/app/:path*",
    "/admin/:path*",
  ],
};
