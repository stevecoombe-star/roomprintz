import { NextRequest } from "next/server";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await callCompositorVibodeStageRun({ payload: body });
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
