import { NextResponse } from "next/server";

import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { isAfcImageModelChoice } from "@/lib/afc-image-models";
import {
  readAfcImageModelSettingsStrict,
  writeAfcImageModelSettings,
  type AfcImageModelSettingsRead,
} from "@/lib/afc-image-model-settings.server";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function settingsBody(result: Extract<AfcImageModelSettingsRead, { ok: true }>) {
  return {
    settings: {
      empty: result.settings.empty,
      tiled: result.settings.tiled,
      updatedAt: result.settings.updatedAt,
    },
  };
}

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });
  const result = await readAfcImageModelSettingsStrict();
  if (!result.ok) return json(500, { error: result.error });
  return json(200, settingsBody(result));
}

export async function PATCH(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });
  const payload = (await request.json().catch(() => ({}))) as {
    empty?: unknown;
    tiled?: unknown;
  };
  if (!isAfcImageModelChoice(payload.empty) || !isAfcImageModelChoice(payload.tiled)) {
    return json(400, { error: "Unknown AFC image model." });
  }
  const result = await writeAfcImageModelSettings({
    empty: payload.empty,
    tiled: payload.tiled,
  });
  if (!result.ok) return json(500, { error: result.error });
  return json(200, { ok: true, ...settingsBody(result) });
}
