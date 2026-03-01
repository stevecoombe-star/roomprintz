import { NextRequest } from "next/server";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await callCompositorVibodeStageRun({ payload: body });
    return Response.json(result);
  } catch (err: any) {
    const message = String(err?.message || err);
    const status = message.includes(" 400 ")
      ? 400
      : message.includes(" 401 ")
      ? 401
      : message.includes(" 403 ")
      ? 403
      : 500;
    return Response.json({ error: message }, { status });
  }
}
