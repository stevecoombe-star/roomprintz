import { NextResponse } from "next/server";

type ValidateCodePayload = {
  code?: unknown;
};

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ValidateCodePayload;
  const providedCode = normalizeCode(payload.code);
  const expectedCode = normalizeCode(process.env.VIBODE_BETA_SIGNUP_CODE);

  if (!expectedCode || providedCode !== expectedCode) {
    return NextResponse.json({ error: "Invalid beta access code." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
