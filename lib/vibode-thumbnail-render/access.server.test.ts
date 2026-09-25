import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/internal/vibode-thumbnail-render/route";

import {
  mintThumbnailRenderToken,
  resetThumbnailRenderAccessForTests,
  verifyThumbnailRenderToken,
} from "./access.server";
import { VIBODE_THUMBNAIL_RENDER_TOKEN_EXPIRES_SEC } from "./contract";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTENT = "d".repeat(64);

test("a missing render token is denied", async () => {
  const response = await GET(new Request("http://localhost/api/internal/vibode-thumbnail-render"));
  assert.equal(response.status, 401);
  const body = await response.json() as { code?: string };
  assert.equal(body.code, "render_access_denied");
});

test("an expired or invalid render token is denied", () => {
  resetThumbnailRenderAccessForTests();
  const minted = mintThumbnailRenderToken({
    jobId: JOB_ID,
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    contentToken: CONTENT,
    nowMs: 1_000,
  });
  assert.ok(minted);
  if (!minted) return;
  assert.equal(
    verifyThumbnailRenderToken(minted.token, 1_000 + VIBODE_THUMBNAIL_RENDER_TOKEN_EXPIRES_SEC * 1000 + 1),
    null,
  );
  assert.equal(verifyThumbnailRenderToken(`${minted.token}tampered`, 1_000), null);
});

test("a valid token keeps its render identity", () => {
  resetThumbnailRenderAccessForTests();
  const minted = mintThumbnailRenderToken({
    jobId: JOB_ID,
    roomId: ROOM_ID,
    versionId: VERSION_ID,
    contentToken: CONTENT,
    nowMs: 5_000,
  });
  assert.ok(minted);
  if (!minted) return;
  const claims = verifyThumbnailRenderToken(minted.token, 5_000);
  assert.equal(claims?.roomId, ROOM_ID);
  assert.equal(claims?.versionId, VERSION_ID);
  assert.equal(claims?.jobId, JOB_ID);
  assert.notEqual(claims?.roomId, VERSION_ID);
});
