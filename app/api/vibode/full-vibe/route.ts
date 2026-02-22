import { NextRequest } from "next/server";
import { callCompositorVibodeFullVibe } from "@/lib/callCompositorVibodeFullVibe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageUrl } = await callCompositorVibodeFullVibe({ payload: body });
    return Response.json({ imageUrl });
  } catch (err: any) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
