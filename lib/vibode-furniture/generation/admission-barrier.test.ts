import assert from "node:assert/strict";
import test from "node:test";

import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";

import { attachGenerationInput, createGenerationDatabase, reserveGeneration } from "./engine";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);

function reserveInput(nowMs = 1_000) {
  return {
    userId: USER,
    jobId: JOB,
    idempotencyKey: "idem-key-0001",
    requestSha256: SHA,
    operation: "image-to-3d" as const,
    settings: defaultFurnitureGeneratorSettings(),
    imageSlots: ["front"] as const,
    reservedCredits: 30,
    nowMs,
  };
}

test("a committed deletion barrier refuses a new hold and a new photo", () => {
  const blocked = createGenerationDatabase();
  blocked.controls.liveEnabled = true;
  blocked.controls.paidSubmissionsAuthorized = 1;
  blocked.accountDeletionUserIds = [USER];
  const denied = reserveGeneration(blocked, reserveInput());
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "account_deletion_in_progress");
  assert.equal(blocked.jobs.length, 0);
  assert.equal(blocked.controls.creditsReserved, 0);
  assert.equal(blocked.controls.paidSubmissionsUsed, 0);

  const open = createGenerationDatabase();
  open.controls.liveEnabled = true;
  open.controls.paidSubmissionsAuthorized = 1;
  const created = reserveGeneration(open, reserveInput());
  assert.equal(created.ok, true);
  open.accountDeletionUserIds = [USER.toUpperCase()];
  const replay = reserveGeneration(open, reserveInput());
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.created, false);
  const attached = attachGenerationInput(open, {
    userId: USER,
    jobId: JOB,
    slot: "front",
    mimeType: "image/jpeg",
    byteSize: 128,
    widthPx: 64,
    heightPx: 64,
    sha256: SHA,
    nowMs: 1_000,
  });
  assert.equal(attached.ok, false);
  if (!attached.ok) assert.equal(attached.code, "account_deletion_in_progress");
  assert.equal(open.inputs.length, 0);
  assert.equal(open.controls.creditsReserved, 30);
  assert.equal(open.controls.paidSubmissionsUsed, 0);
});
