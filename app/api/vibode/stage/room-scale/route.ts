import {
  handleStageRoomScaleGet,
  handleStageRoomScalePut,
} from "@/lib/vibode-stage/room-scale.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleStageRoomScaleGet(request);
}

export async function PUT(request: Request) {
  return handleStageRoomScalePut(request);
}
