import { NextRequest } from "next/server";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const modelVersion =
      typeof body?.modelVersion === "string" && body.modelVersion.trim().length > 0
        ? body.modelVersion
        : VIBODE_DEFAULT_MODEL_VERSION;
    const result = await callCompositorVibodeStageRun({
      payload: {
        ...body,
        modelVersion,
      },
    });
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
