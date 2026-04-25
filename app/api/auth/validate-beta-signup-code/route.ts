import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readGlobalBetaSettings } from "@/lib/betaSettings.server";

type ValidateCodePayload = {
  code?: unknown;
};

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ValidateCodePayload;
  const providedCode = normalizeCode(payload.code);

  let expectedCode = "";
  try {
    const supabaseAdmin = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    const settings = await readGlobalBetaSettings(supabaseAdmin, {
      allowLocalEnvFallback: true,
    });
    expectedCode = normalizeCode(settings.betaAccessCode);
  } catch {
    // Safe-fail behavior: reject if server settings are unavailable.
    return NextResponse.json(
      { error: "Beta access validation is temporarily unavailable." },
      { status: 503 }
    );
  }

  if (!expectedCode || providedCode !== expectedCode) {
    return NextResponse.json({ error: "Invalid beta access code." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
