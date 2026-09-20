import "server-only";

import { NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/adminAccess";
import { getCookieSupabaseClient } from "@/lib/adminServer";

export type AfcDiagnosticsAdminActor = Readonly<{
  userId: string;
  email: string;
}>;

export type AfcDiagnosticsAdminAuth =
  | { ok: true; admin: AfcDiagnosticsAdminActor }
  | { ok: false; response: NextResponse };

export type AfcDiagnosticsAdminCookieClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

export type AuthorizeAfcDiagnosticsAdminOptions = Readonly<{
  getCookieClient?: () => Promise<AfcDiagnosticsAdminCookieClient | null>;
  isAdmin?: typeof isAdminEmail;
}>;

export function afcDiagnosticsAdminJson(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function authorizeAfcDiagnosticsAdmin(
  options: AuthorizeAfcDiagnosticsAdminOptions = {},
): Promise<AfcDiagnosticsAdminAuth> {
  const getCookieClient = options.getCookieClient ?? getCookieSupabaseClient;
  const isAdmin = options.isAdmin ?? isAdminEmail;

  const supabase = await getCookieClient();
  if (!supabase) {
    return {
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Server error." }, 500),
    };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return {
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
    };
  }

  if (!isAdmin(data.user.email)) {
    return {
      ok: false,
      response: afcDiagnosticsAdminJson(
        { error: "Admin access required." },
        403,
      ),
    };
  }

  return {
    ok: true,
    admin: Object.freeze({
      userId: data.user.id,
      email: typeof data.user.email === "string" ? data.user.email : "",
    }),
  };
}
