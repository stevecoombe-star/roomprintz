import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type StageRunRequest = {
  stageNumber?: unknown;
  options?: unknown;
  baseImageId?: unknown;
  lastStageOutputs?: unknown;
};

function toStageNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as StageRunRequest;
    const stageNumber = toStageNumber(body.stageNumber);
    if (!stageNumber) {
      return NextResponse.json(
        { ok: false, message: "stageNumber must be an integer from 1 to 5." },
        { status: 400 }
      );
    }

    const normalizedBaseImageId =
      typeof body.baseImageId === "string" && body.baseImageId.trim().length > 0
        ? body.baseImageId.trim()
        : `base_${Date.now()}`;

    return NextResponse.json({
      ok: true,
      stageNumber,
      baseImageId: normalizedBaseImageId,
      output: {
        stageNumber,
        options: body.options ?? {},
        receivedLastStageOutputs:
          body.lastStageOutputs && typeof body.lastStageOutputs === "object"
            ? body.lastStageOutputs
            : {},
        ranAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected stage-run error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
