import { NextRequest } from "next/server";
import { handleVibodeGeneratePost } from "../generate/route";

export { runtime } from "../generate/route";

export async function POST(req: NextRequest) {
  return handleVibodeGeneratePost(req, { routeMode: "compose" });
}
