import { NextResponse } from "next/server";

import { harmonizePublicBody, harmonizePublicStatus } from "./status";

export function harmonizeJson(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function harmonizeError(code: string): NextResponse {
  return harmonizeJson(harmonizePublicBody(code), harmonizePublicStatus(code));
}
