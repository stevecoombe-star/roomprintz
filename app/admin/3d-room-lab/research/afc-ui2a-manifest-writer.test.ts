import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAfcUi2aImageManifest, stableAfcUi2aManifestBytes, writeAfcUi2aImageManifest } from "./afc-ui2a-manifest-writer";
import { buildAfcUi2aSharedComparisonContext } from "./afc-ui2a-shared-context";

const original = {
  fileName: "room-a.original.ca9d77cb4b951ce95ed4fa261b55b288164b07e757dbdf5da565eafefc3439b7.jpg",
  sha256: "ca9d77cb4b951ce95ed4fa261b55b288164b07e757dbdf5da565eafefc3439b7",
  byteCount: 486995,
  mimeType: "image/jpeg" as const,
  decodedWidth: 1264,
  decodedHeight: 848,
  orientation: 1 as const,
};
const emptyRoomAssist = {
  fileName: "room-a.empty-room.d5f9b40ffbe2789d4756d72162b1d4a38d505da67b36e5deb9b2a9e0ec5bb686.png",
  sha256: "d5f9b40ffbe2789d4756d72162b1d4a38d505da67b36e5deb9b2a9e0ec5bb686",
  byteCount: 1199149,
  mimeType: "image/png" as const,
  decodedWidth: 1264,
  decodedHeight: 848,
  orientation: 1 as const,
  generatedFromOriginalSha256: original.sha256,
  generatorId: "vibode-empty-room-assist/stage1-empty-room/v1",
  requestedModelId: "NBP" as const,
  resolvedModelId: null,
  resolvedModelStatus: "not_reported_by_compositor" as const,
};

test("UI2A manifest construction is the Room A canonical fixture fixed point", async () => {
  const context = buildAfcUi2aSharedComparisonContext({
    roomId: "room-a", originalSha256: original.sha256, originalWidth: 1264, originalHeight: 848,
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const result = buildAfcUi2aImageManifest({ roomId: "room-a", images: { original, emptyRoomAssist }, sharedComparisonContext: context.context });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bytes = stableAfcUi2aManifestBytes(result.manifest);
  const fixture = await readFile(path.join(process.cwd(), "app/admin/3d-room-lab/research/fixtures/afc-ui2a-room-a-manifest.v1.json"));
  assert.deepEqual(bytes, fixture);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "9c540ed3c4038a86d231bc8d85eacdb42f90392d83eb348e952af2fbdd14708f");
  assert.equal(bytes.at(-1), 10);
  assert.equal(bytes.toString("utf8").includes("compatibility"), false);
  assert.equal(bytes.toString("utf8").includes("packageId"), false);
});

test("UI2A manifest writer writes once, reuses exact bytes, adopts semantic bytes, and refuses conflicts", async () => {
  const context = buildAfcUi2aSharedComparisonContext({
    roomId: "room-a", originalSha256: original.sha256, originalWidth: 1264, originalHeight: 848,
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const built = buildAfcUi2aImageManifest({ roomId: "room-a", images: { original, emptyRoomAssist }, sharedComparisonContext: context.context });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const directory = await mkdtemp(path.join(os.tmpdir(), "afc-ui2a-manifest-"));
  const bytes = stableAfcUi2aManifestBytes(built.manifest);
  const name = "afc-r3c-room-a.image-manifest.v1.json";
  try {
    const first = await writeAfcUi2aImageManifest({ roomDirectory: directory, roomId: "room-a", expectedManifest: built.manifest, expectedBytes: bytes });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.disposition, "written");
    const second = await writeAfcUi2aImageManifest({ roomDirectory: directory, roomId: "room-a", expectedManifest: built.manifest, expectedBytes: bytes });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.disposition, "byte_identical");
    await writeFile(path.join(directory, name), JSON.stringify(built.manifest));
    const adopted = await writeAfcUi2aImageManifest({ roomDirectory: directory, roomId: "room-a", expectedManifest: built.manifest, expectedBytes: bytes });
    assert.equal(adopted.ok, true);
    if (!adopted.ok) return;
    assert.equal(adopted.disposition, "semantically_adopted");
    await writeFile(path.join(directory, name), JSON.stringify({ ...built.manifest, roomId: "room-b" }));
    const conflict = await writeAfcUi2aImageManifest({ roomDirectory: directory, roomId: "room-a", expectedManifest: built.manifest, expectedBytes: bytes });
    assert.deepEqual(conflict, { ok: false, failureCode: "manifest_conflict" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
