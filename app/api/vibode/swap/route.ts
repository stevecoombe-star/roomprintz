import { NextRequest } from "next/server";
import { handleVibodeGeneratePost } from "../generate/route";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleVibodeGeneratePost(req, { routeMode: "swap" });
}
