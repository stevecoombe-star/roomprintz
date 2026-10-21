import {
  REMOVE_EDIT_ALIGNMENT_ERROR,
  REMOVE_EDIT_SAVE_ERROR,
  REMOVE_EDIT_STALE_ERROR,
} from "@/lib/vibode-stage/remove-edit";
import {
  publishPreparedRemoveEdit,
  type RemoveEditStorage,
  type RemoveEditSubmission,
} from "@/lib/vibode-stage/remove-edit-publish.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RemoveEditHttpDeps = Readonly<{
  getAdmin: () => Promise<{ id: string } | null>;
  loadSubmission: (
    adminId: string,
    body: Readonly<{
      roomId: string;
      generationId: string;
      parentAssetId: string;
      keepSha256: string;
      keepWidth: number;
      keepHeight: number;
      width: number;
      height: number;
      coverageBase64: string;
    }>,
  ) => Promise<RemoveEditSubmission | Readonly<{ ok: false; status: number; error: string }>>;
  storage: RemoveEditStorage;
}>;

export async function handleRemoveEditPost(request: Request, deps: RemoveEditHttpDeps): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin) return json({ error: "Not found." }, 404);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const body = readBody(payload);
  if (!body) return json({ error: "Invalid request." }, 400);
  const loaded = await deps.loadSubmission(admin.id, body);
  if (!("report" in loaded)) return json({ error: loaded.error }, loaded.status);
  if (loaded.userId !== admin.id) return json({ error: "Not found." }, 404);
  const published = await publishPreparedRemoveEdit(deps.storage, loaded);
  if (!published.ok) {
    const status = published.code === "not_found"
      ? 404
      : published.code === "incompatible"
        ? 409
        : published.code === "unchanged"
        ? 409
        : published.code === "stale"
          ? 409
          : published.code === "invalid"
            ? 400
            : 503;
    return json({ error: errorCopy(published.code), code: published.code }, status);
  }
  return json({
    saved: true,
    created: published.created,
    assetId: published.assetId,
    activated: false,
  }, 200);
}

function readBody(value: unknown): {
  roomId: string;
  generationId: string;
  parentAssetId: string;
  keepSha256: string;
  keepWidth: number;
  keepHeight: number;
  width: number;
  height: number;
  coverageBase64: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.roomId !== "string" || !UUID.test(body.roomId)) return null;
  if (typeof body.generationId !== "string" || !UUID.test(body.generationId)) return null;
  if (typeof body.parentAssetId !== "string" || !UUID.test(body.parentAssetId)) return null;
  if (typeof body.keepSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(body.keepSha256)) return null;
  if (!Number.isInteger(body.keepWidth) || !Number.isInteger(body.keepHeight)) return null;
  if (!Number.isInteger(body.width) || !Number.isInteger(body.height)) return null;
  if (typeof body.coverageBase64 !== "string" || body.coverageBase64.length === 0) return null;
  return {
    roomId: body.roomId,
    generationId: body.generationId,
    parentAssetId: body.parentAssetId,
    keepSha256: body.keepSha256.toLowerCase(),
    keepWidth: body.keepWidth as number,
    keepHeight: body.keepHeight as number,
    width: body.width as number,
    height: body.height as number,
    coverageBase64: body.coverageBase64,
  };
}

function errorCopy(code: string): string {
  if (code === "incompatible") return REMOVE_EDIT_ALIGNMENT_ERROR;
  if (code === "unchanged") return "There are no Remove edits to save.";
  if (code === "not_found") return "Not found.";
  if (code === "invalid") return "The Remove image could not be read.";
  if (code === "stale") return REMOVE_EDIT_STALE_ERROR;
  return REMOVE_EDIT_SAVE_ERROR;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
