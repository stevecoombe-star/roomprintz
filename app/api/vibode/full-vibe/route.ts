import { NextRequest } from "next/server";
import { callCompositorVibodeFullVibe } from "@/lib/callCompositorVibodeFullVibe";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const modelVersion =
      typeof body.modelVersion === "string" && body.modelVersion.trim().length > 0
        ? body.modelVersion
        : VIBODE_DEFAULT_MODEL_VERSION;
    const { imageUrl } = await callCompositorVibodeFullVibe({
      payload: {
        ...body,
        modelVersion,
      },
    });
    return Response.json({ imageUrl });
  } catch (err: any) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
