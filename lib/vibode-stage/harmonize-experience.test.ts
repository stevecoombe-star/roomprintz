import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "@/lib/vibode-stage/harmonize-export";
import { harmonizeStatusFromRecord } from "@/lib/vibode-stage/harmonize-jobs/status";
import { harmonizeProviderAcceptsComposite } from "@/lib/vibode-stage/harmonize-jobs/provider-capability";
import { createHarmonizeQaAttemptGate } from "@/lib/vibode-stage/harmonize-qa";
import {
  HARMONIZE_AI_DISCLOSURE_KEY,
  HARMONIZE_AI_DISCLOSURE_TEXT,
  HARMONIZE_AI_LABEL,
  HARMONIZE_HISTORY_SAVED_NOTICE,
  HARMONIZE_SCENE_UNAVAILABLE,
  harmonizeAcknowledgementGrantsAccess,
  harmonizeButtonAccess,
  harmonizeButtonLabel,
  harmonizeCanSubmit,
  harmonizeDisclosureGate,
  harmonizeExperiencePhase,
  harmonizeHistoryAccess,
  harmonizeLiveBackgroundSha256,
  harmonizeSourceSceneResolution,
  harmonizePhaseBusy,
  harmonizeShouldPoll,
  harmonizeShouldSettlePublication,
  harmonizeWatchJobId,
  hashHarmonizeSceneObjects,
  isHarmonizedHistoryAsset,
  planHarmonizeEditorPresentation,
  planHarmonizePublicationView,
  readHarmonizeExperienceJobRecord,
  readHarmonizeHistoryViewResponse,
  resolveHarmonizeBackdrop,
  type HarmonizeExperienceJob,
  type HarmonizeHistoryView,
  type HarmonizeLiveCapture,
} from "@/lib/vibode-stage/harmonize-experience";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const OTHER_SOURCE = "44444444-4444-4444-8444-444444444444";
const OUTPUT = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const GENERATION = "77777777-7777-4777-8777-777777777777";
const SHA = "ab".repeat(32);
const SCENE = "cd".repeat(32);

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function job(patch: Partial<HarmonizeExperienceJob> = {}): HarmonizeExperienceJob {
  return {
    id: JOB,
    status: "succeeded",
    historyState: "published",
    outputAssetId: OUTPUT,
    outputActive: false,
    roomId: ROOM,
    sourceVersionId: SOURCE,
    afcGenerationId: GENERATION,
    backdropKind: "room_asset",
    sceneObjectsSha256: SCENE,
    backgroundSha256: SHA,
    roomScaleMultiplier: 1,
    failureCode: null,
    failureMessage: null,
    ...patch,
  };
}

function live(patch: Partial<HarmonizeLiveCapture> = {}): HarmonizeLiveCapture {
  return {
    roomId: ROOM,
    sourceVersionId: SOURCE,
    afcGenerationId: GENERATION,
    roomScaleMultiplier: 1,
    sceneObjectsSha256: SCENE,
    backgroundSha256: SHA,
    ...patch,
  };
}

const VERSIONS = [
  { id: SOURCE, imageUrl: "https://images.example.test/source.jpg" },
  { id: OUTPUT, imageUrl: "https://images.example.test/harmonized.jpg" },
];

function historyView(patch: Partial<HarmonizeHistoryView> = {}): HarmonizeHistoryView {
  return {
    assetId: OUTPUT,
    sourceVersionId: SOURCE,
    afcGenerationId: GENERATION,
    backdropKind: "room_asset",
    outputActive: false,
    ...patch,
  };
}

const HARMONIZED_SELECTED = {
  id: OUTPUT,
  imageUrl: VERSIONS[1].imageUrl,
  harmonizeJobId: JOB,
};

const OWNER = "88888888-8888-4888-8888-888888888888";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

test("button access stays admin-only and disabled while generation is off", () => {
  assert.equal(harmonizeButtonAccess({ isAdmin: false, available: true, qaReady: true }), "hidden");
  assert.equal(harmonizeButtonAccess({ isAdmin: true, available: false, qaReady: true }), "disabled");
  assert.equal(harmonizeButtonAccess({ isAdmin: true, available: null, qaReady: true }), "disabled");
  assert.equal(harmonizeButtonAccess({ isAdmin: true, available: true, qaReady: false }), "disabled");
  assert.equal(harmonizeButtonAccess({ isAdmin: true, available: true, qaReady: true }), "ready");
  assert.equal(harmonizeAcknowledgementGrantsAccess(), false);
  assert.equal(harmonizeButtonLabel("running").includes("%"), false);
  const header = source("components/stage/StageEditorHeader.tsx");
  assert.match(header, /<HarmonizeButton \/>/);
  assert.match(header, /<HarmonizeExportButton \/>/);
  assert.match(header, /<HarmonizeQaButton \/>/);
});

test("first-use disclosure asks, decline stops, and a recorded acceptance can repeat", () => {
  assert.equal(HARMONIZE_AI_DISCLOSURE_KEY, "harmonize_ai_disclosure_v1");
  assert.equal(
    HARMONIZE_AI_DISCLOSURE_TEXT,
    "AI-generated image — for inspiration. Colors, materials, textures and product details may differ from the actual products. Check the retailer's product information before purchasing.",
  );
  assert.equal(harmonizeDisclosureGate("unknown"), "ask");
  assert.equal(harmonizeDisclosureGate("declined"), "stop");
  assert.equal(harmonizeDisclosureGate("accepted"), "proceed");
  const route = source("app/api/vibode/harmonize/acknowledgement/route.ts");
  const button = source("components/stage/HarmonizeExperience.tsx");
  assert.match(route, /readHarmonizeActor/);
  assert.match(route, /getCookieSupabaseClient/);
  assert.match(route, /HARMONIZE_AI_DISCLOSURE_KEY/);
  assert.doesNotMatch(route, /getServiceRoleSupabaseClient/);
  assert.doesNotMatch(button, /localStorage/);
  assert.match(button, /sessionStorage/);
  assert.match(button, /HARMONIZE_AI_DISCLOSURE_TEXT/);
});

test("a second click cannot start another capture while one is in flight", () => {
  const gate = createHarmonizeQaAttemptGate(() => JOB);
  assert.equal(gate.start(), JOB);
  assert.equal(gate.start(), null);
  gate.finish();
  assert.equal(gate.start(), JOB);
  const access = harmonizeButtonAccess({ isAdmin: true, available: true, qaReady: true });
  assert.equal(harmonizeCanSubmit({ access, phase: "preparing", gateHeld: false }), false);
  assert.equal(harmonizeCanSubmit({ access, phase: "idle", gateHeld: true }), false);
  assert.equal(harmonizeCanSubmit({ access, phase: "queued", gateHeld: false }), false);
  assert.match(source("components/stage/HarmonizeExperience.tsx"), /attemptGate\.start\(\)/);
  assert.match(source("components/stage/HarmonizeExperience.tsx"), /control\.runQa\(idempotencyKey\)/);
  assert.match(source("components/stage/HarmonizeExperience.tsx"), /submitHarmonizeQaAttempt/);
});

test("capture waits on the existing scene and Room Scale barrier", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const button = source("components/stage/HarmonizeExperience.tsx");
  assert.match(viewer, /runHarmonizeCaptureBoundary/);
  assert.match(viewer, /flushScene/);
  assert.match(viewer, /flushRoomScale/);
  assert.doesNotMatch(button, /flushScene|flushRoomScale/);
  assert.equal(harmonizeCanSubmit({
    access: "ready",
    phase: "preparing",
    gateHeld: false,
  }), false);
});

test("refresh restores queued, running, and History-pending phases without settling another job", () => {
  assert.equal(harmonizeExperiencePhase({ submitting: false, job: job({ status: "queued", historyState: "pending" }) }), "queued");
  assert.equal(harmonizeExperiencePhase({ submitting: false, job: job({ status: "running", historyState: "pending" }) }), "running");
  assert.equal(harmonizeExperiencePhase({ submitting: false, job: job({ status: "succeeded", historyState: "pending" }) }), "publishing");
  assert.equal(harmonizeShouldPoll("running"), true);
  assert.equal(harmonizeShouldPoll("published"), false);
  assert.equal(harmonizeWatchJobId({ jobId: JOB, phase: "running", watchedJobId: null }), null);
  assert.equal(harmonizeWatchJobId({ jobId: JOB, phase: "running", watchedJobId: JOB }), JOB);
  assert.equal(harmonizeShouldSettlePublication({ jobId: JOB, phase: "running", watchedJobId: JOB }), false);
  assert.equal(harmonizeShouldSettlePublication({ jobId: JOB, phase: "published", watchedJobId: OTHER_ROOM }), false);
  assert.equal(harmonizeShouldSettlePublication({
    jobId: JOB,
    phase: "blocked",
    watchedJobId: JOB,
  }), false);
  const restored = readHarmonizeExperienceJobRecord({
    id: JOB,
    status: "running",
    historyState: "pending",
    roomId: ROOM,
  });
  assert.equal(restored?.status, "running");
  assert.equal(restored?.historyState, "pending");
});

test("a published match reloads History and shows 2D only when the server activated it", () => {
  const inactive = planHarmonizePublicationView({
    job: job({ outputActive: false }),
    versions: VERSIONS,
    live: live(),
  });
  assert.equal(inactive.action, "notice");
  assert.equal(inactive.assetId, null);
  assert.equal(inactive.activate, false);
  assert.equal(inactive.insertHistory, false);
  const decision = planHarmonizePublicationView({
    job: job({ outputActive: true }),
    versions: VERSIONS,
    live: live(),
  });
  assert.equal(decision.action, "show-2d");
  assert.equal(decision.assetId, OUTPUT);
  assert.equal(decision.activate, false);
  assert.equal(decision.reloadHistory, true);
  assert.equal(decision.insertHistory, false);
  const editor = source("app/editor/page.tsx");
  const settle = editor.slice(
    editor.indexOf("const settleHarmonizePublication"),
    editor.indexOf("const selectedVersionRenderedPlacementStateHash"),
  );
  assert.match(settle, /refreshRoomVersions/);
  assert.match(settle, /planHarmonizePublicationView/);
  assert.ok(
    settle.indexOf("setActiveAssetId(previousActiveId ?? sourceVersionId)")
    < settle.indexOf("planHarmonizePublicationView"),
  );
  assert.doesNotMatch(settle, /setActiveVersionForRoom/);
  const selectFn = editor.slice(
    editor.indexOf("const handleSelectVersion = useCallback"),
    editor.indexOf("const handleSelectVersionFromTimeline"),
  );
  assert.ok(selectFn.indexOf("applyVersionToEditorState") < selectFn.indexOf("isHarmonizedHistoryAsset"));
  assert.ok(selectFn.indexOf("is_active !== true) return") < selectFn.indexOf("setActiveVersionForRoom"));
});

test("a scene change keeps History and does not switch the viewport", () => {
  const decision = planHarmonizePublicationView({
    job: job({ outputActive: true }),
    versions: VERSIONS,
    live: live({ sceneObjectsSha256: "ef".repeat(32) }),
  });
  assert.equal(decision.action, "notice");
  assert.equal(decision.message, HARMONIZE_HISTORY_SAVED_NOTICE);
  assert.equal(decision.activate, false);
  assert.equal(decision.insertHistory, false);
});

test("a changed source version or room keeps the current view", () => {
  const sourceChanged = planHarmonizePublicationView({
    job: job({ outputActive: true }),
    versions: VERSIONS,
    live: live({ sourceVersionId: OTHER_SOURCE, backgroundSha256: null }),
  });
  const roomChanged = planHarmonizePublicationView({
    job: job({ outputActive: true }),
    versions: VERSIONS,
    live: live({ roomId: OTHER_ROOM }),
  });
  assert.equal(sourceChanged.action, "notice");
  assert.equal(roomChanged.action, "notice");
  assert.equal(sourceChanged.assetId, null);
  assert.equal(roomChanged.assetId, null);
});

test("a selected Harmonized image is a labeled 2D photograph", () => {
  const presentation = planHarmonizeEditorPresentation({
    selected: HARMONIZED_SELECTED,
    versions: VERSIONS,
    presentation: historyView(),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: "https://images.example.test/empty.png",
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(presentation.harmonized, true);
  assert.equal(presentation.showAiLabel, true);
  assert.equal(HARMONIZE_AI_LABEL, "AI-generated");
  assert.equal(presentation.renderFurnitureOnHarmonizedImage, false);
  assert.notEqual(presentation.backgroundImageUrl, VERSIONS[1].imageUrl);
  assert.match(source("components/editor/ImageHistoryTimeline.tsx"), /HARMONIZE_AI_LABEL/);
  assert.match(source("app/editor/page.tsx"), /harmonizePresentation\.showAiLabel/);
});

test("returning to 3D uses the source scene and the trusted backdrop", () => {
  const presentation = planHarmonizeEditorPresentation({
    selected: HARMONIZED_SELECTED,
    versions: VERSIONS,
    presentation: historyView({ backdropKind: "afc_original" }),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: "https://images.example.test/empty.png",
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(presentation.sceneVersionId, SOURCE);
  assert.equal(presentation.backgroundImageUrl, "https://images.example.test/original.jpg");
  assert.equal(presentation.lockBackground, true);
  assert.equal(presentation.mountViewer, true);
  const editor = source("app/editor/page.tsx");
  assert.match(editor, /versionId=\{integratedSceneVersionId\}/);
  assert.match(editor, /lockBackgroundImage=\{harmonizePresentation\.lockBackground\}/);
});

test("the Harmonized photograph is not a second furniture render", () => {
  const presentation = planHarmonizeEditorPresentation({
    selected: HARMONIZED_SELECTED,
    versions: VERSIONS,
    presentation: historyView(),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: null,
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(presentation.renderFurnitureOnHarmonizedImage, false);
  assert.equal(presentation.backgroundImageUrl, VERSIONS[0].imageUrl);
  assert.notEqual(presentation.sceneVersionId, OUTPUT);
});

test("PI-4D does not fork a scene for a Harmonized version", () => {
  const server = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  const resolveFn = server.slice(
    server.indexOf("export async function resolveOwnedVersionScene"),
    server.indexOf("export async function saveOwnedVersionScene"),
  );
  assert.ok(resolveFn.indexOf("harmonizeOutputGuard") < resolveFn.indexOf("resolveVersionScene("));
  assert.match(resolveFn, /harmonize-output/);
  assert.doesNotMatch(resolveFn, /order\("created_at"\)/);
  const saveFn = server.slice(server.indexOf("export async function saveOwnedVersionScene"));
  assert.match(saveFn, /harmonizeOutputGuard/);
  assert.match(saveFn, /Harmonized images do not have an editable 3D scene/);
  assert.equal(isHarmonizedHistoryAsset({ metadata: { harmonizeJobId: JOB } }), false);
  assert.equal(isHarmonizedHistoryAsset({ harmonize_job_id: JOB }), true);
  assert.equal(isHarmonizedHistoryAsset({ metadata: { ai_generated: true } }), false);
  const guard = server.slice(
    server.indexOf("async function harmonizeOutputGuard"),
    server.indexOf("function rowToScene"),
  );
  assert.match(guard, /harmonize_job_id/);
  assert.doesNotMatch(guard, /metadata/);
  assert.doesNotMatch(guard, /order\("created_at"\)/);
});

test("live edits and autosaves target the source version", () => {
  const presentation = planHarmonizeEditorPresentation({
    selected: {
      ...HARMONIZED_SELECTED,
      imageUrl: VERSIONS[1].imageUrl,
    },
    versions: VERSIONS,
    presentation: historyView({ sourceVersionId: SOURCE }),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: null,
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(presentation.saveVersionId, SOURCE);
  assert.equal(presentation.forkScene, false);
  const ignoredMetadata = planHarmonizeEditorPresentation({
    selected: { id: OUTPUT, imageUrl: VERSIONS[1].imageUrl, harmonizeJobId: null },
    versions: VERSIONS,
    presentation: historyView({ sourceVersionId: OTHER_SOURCE }),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: null,
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(ignoredMetadata.harmonized, false);
  assert.equal(ignoredMetadata.sceneVersionId, OUTPUT);
  const ordinary = planHarmonizeEditorPresentation({
    selected: { id: SOURCE, imageUrl: VERSIONS[0].imageUrl, harmonizeJobId: null },
    versions: VERSIONS,
    presentation: null,
    selectionStatus: "idle",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: null,
    standardBackgroundUrl: VERSIONS[0].imageUrl,
  });
  assert.equal(ordinary.sceneVersionId, SOURCE);
  assert.equal(ordinary.backgroundImageUrl, VERSIONS[0].imageUrl);
  assert.equal(ordinary.lockBackground, false);
});

test("original, empty, and room-state backdrops stay distinct", () => {
  const shared = {
    harmonizedImageUrl: VERSIONS[1].imageUrl,
    sourceImageUrl: VERSIONS[0].imageUrl,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: "https://images.example.test/empty.png",
    originalValid: true,
  };
  assert.equal(resolveHarmonizeBackdrop({ ...shared, backdropKind: "afc_original" }), shared.originalImageUrl);
  assert.equal(resolveHarmonizeBackdrop({ ...shared, backdropKind: "afc_empty" }), shared.emptyImageUrl);
  assert.equal(resolveHarmonizeBackdrop({ ...shared, backdropKind: "room_asset" }), shared.sourceImageUrl);
  assert.notEqual(resolveHarmonizeBackdrop({ ...shared, backdropKind: "afc_empty" }), shared.originalImageUrl);
});

test("a deleted source does not invent furniture, and a missing room backdrop never becomes the Harmonized JPEG", () => {
  const deleted = planHarmonizeEditorPresentation({
    selected: HARMONIZED_SELECTED,
    versions: [VERSIONS[1]],
    presentation: historyView(),
    selectionStatus: "ready",
    generationId: GENERATION,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: "https://images.example.test/empty.png",
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(deleted.mountViewer, false);
  assert.equal(deleted.sceneVersionId, null);
  assert.equal(deleted.unavailableMessage, HARMONIZE_SCENE_UNAVAILABLE);
  const missingRoom = resolveHarmonizeBackdrop({
    backdropKind: "room_asset",
    harmonizedImageUrl: VERSIONS[1].imageUrl,
    sourceImageUrl: null,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: VERSIONS[1].imageUrl,
    originalValid: true,
  });
  assert.equal(missingRoom, "https://images.example.test/original.jpg");
  const staleOriginal = resolveHarmonizeBackdrop({
    backdropKind: "room_asset",
    harmonizedImageUrl: VERSIONS[1].imageUrl,
    sourceImageUrl: null,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: null,
    originalValid: false,
  });
  assert.equal(staleOriginal, null);
  assert.equal(resolveHarmonizeBackdrop({
    backdropKind: "afc_empty",
    harmonizedImageUrl: VERSIONS[1].imageUrl,
    sourceImageUrl: null,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: VERSIONS[1].imageUrl,
    originalValid: true,
  }), null);
  assert.equal(missingRoom === VERSIONS[1].imageUrl, false);
});

test("History viewing is owner-scoped and stays available when generation is off", () => {
  const asset = {
    id: OUTPUT,
    roomId: ROOM,
    userId: OWNER,
    harmonizeJobId: JOB,
    isActive: false,
  };
  const published = {
    id: JOB,
    userId: OWNER,
    roomId: ROOM,
    outputAssetId: OUTPUT,
    sourceVersionId: SOURCE,
    afcGenerationId: GENERATION,
    backdropKind: "afc_empty",
    historyState: "published",
    status: "succeeded",
  };
  const ready = harmonizeHistoryAccess({
    callerUserId: OWNER,
    roomId: ROOM,
    assetId: OUTPUT,
    asset,
    job: published,
  });
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") {
    assert.equal(ready.view.backdropKind, "afc_empty");
    assert.equal(ready.view.sourceVersionId, SOURCE);
    assert.equal(ready.view.outputActive, false);
  }
  assert.equal(harmonizeHistoryAccess({
    callerUserId: OWNER,
    roomId: ROOM,
    assetId: OUTPUT,
    asset: { ...asset, userId: OTHER_USER },
    job: published,
  }).status, "hidden");
  assert.equal(harmonizeHistoryAccess({
    callerUserId: OWNER,
    roomId: ROOM,
    assetId: OUTPUT,
    asset,
    job: { ...published, userId: OTHER_USER },
  }).status, "hidden");
  assert.equal(harmonizeHistoryAccess({
    callerUserId: OWNER,
    roomId: ROOM,
    assetId: OUTPUT,
    asset,
    job: { ...published, outputAssetId: SOURCE },
  }).status, "hidden");
  assert.equal(harmonizeHistoryAccess({
    callerUserId: OWNER,
    roomId: ROOM,
    assetId: OUTPUT,
    asset,
    job: { ...published, historyState: "pending" },
  }).status, "hidden");
  const route = source("app/api/vibode/harmonize/presentation/route.ts");
  const reader = source("lib/vibode-stage/harmonize-jobs/presentation.server.ts");
  const jobs = source("app/api/vibode/harmonize/jobs/route.ts");
  const button = source("components/stage/HarmonizeExperience.tsx");
  assert.doesNotMatch(route, /readHarmonizeActor|VIBODE_HARMONIZE_MODE|enqueueHarmonize|recoverHarmonizeGenerationHistory/);
  assert.doesNotMatch(reader, /prompt|scene_objects|output_path|recoverHarmonizeGenerationHistory|readHarmonizeActor/);
  assert.match(reader, /\.eq\("user_id", input\.userId\)/);
  assert.match(jobs, /readHarmonizeActor/);
  assert.match(button, /\/api\/vibode\/harmonize\/presentation\?/);
  assert.doesNotMatch(button, /\/api\/vibode\/harmonize\/jobs\/\$\{/);
  assert.match(button, /acceptLock\.current/);
  assert.match(source("components/stage/StageEditorContext.tsx"), /useRoomScale\(roomId\)/);
  const parsed = readHarmonizeHistoryViewResponse({
    harmonized: true,
    assetId: OUTPUT,
    sourceVersionId: SOURCE,
    afcGenerationId: GENERATION,
    backdropKind: "afc_original",
    outputActive: true,
    prompt: "UNIQUE_PROMPT_SENTINEL",
  });
  assert.equal(parsed !== "ordinary" && parsed !== null && parsed.backdropKind, "afc_original");
  assert.doesNotMatch(JSON.stringify(parsed), /UNIQUE_PROMPT_SENTINEL/);
  const empty = planHarmonizeEditorPresentation({
    selected: HARMONIZED_SELECTED,
    versions: VERSIONS,
    presentation: historyView({ backdropKind: "afc_empty" }),
    selectionStatus: "ready",
    generationId: OTHER_ROOM,
    originalImageUrl: "https://images.example.test/original.jpg",
    emptyImageUrl: "https://images.example.test/empty.png",
    standardBackgroundUrl: VERSIONS[1].imageUrl,
  });
  assert.equal(empty.mountViewer, false);
  assert.equal(empty.backgroundImageUrl, null);
});

test("a deleted Harmonized source scene does not inherit a replacement arrangement", () => {
  const asset = {
    id: OUTPUT,
    roomId: ROOM,
    userId: OWNER,
    harmonizeJobId: JOB,
  };
  const published = {
    id: JOB,
    userId: OWNER,
    roomId: ROOM,
    sourceVersionId: SOURCE,
    outputAssetId: OUTPUT,
    historyState: "published",
    status: "succeeded",
  };
  assert.equal(harmonizeSourceSceneResolution({
    callerUserId: OWNER,
    roomId: ROOM,
    sourceVersionId: SOURCE,
    harmonizeAssetId: OUTPUT,
    asset,
    job: published,
    scene: "missing",
  }), "missing");
  assert.equal(harmonizeSourceSceneResolution({
    callerUserId: OWNER,
    roomId: ROOM,
    sourceVersionId: SOURCE,
    harmonizeAssetId: OUTPUT,
    asset,
    job: published,
    scene: "present",
  }), "present");
  assert.equal(harmonizeSourceSceneResolution({
    callerUserId: OTHER_USER,
    roomId: ROOM,
    sourceVersionId: SOURCE,
    harmonizeAssetId: OUTPUT,
    asset,
    job: published,
    scene: "missing",
  }), "deny");
  assert.equal(harmonizeSourceSceneResolution({
    callerUserId: OWNER,
    roomId: ROOM,
    sourceVersionId: OTHER_SOURCE,
    harmonizeAssetId: OUTPUT,
    asset,
    job: published,
    scene: "missing",
  }), "deny");
  const reader = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  const readFn = reader.slice(
    reader.indexOf("export async function readOwnedHarmonizeSourceScene"),
    reader.indexOf("export async function resolveOwnedVersionScene"),
  );
  const resolveFn = reader.slice(
    reader.indexOf("export async function resolveOwnedVersionScene"),
    reader.indexOf("export async function saveOwnedVersionScene"),
  );
  assert.match(readFn, /harmonizeSourceSceneResolution/);
  assert.match(readFn, /harmonize-source-missing/);
  assert.doesNotMatch(readFn, /resolveVersionScene|insertChildSceneIfAbsent|insertOwnedVersionSceneIfAbsent/);
  assert.match(resolveFn, /resolveVersionScene\(/);
  assert.match(resolveFn, /insertChildSceneIfAbsent/);
  const route = source("app/api/vibode/3d-scene/route.ts");
  assert.match(route, /readOwnedHarmonizeSourceScene/);
  assert.match(route, /resolveOwnedVersionScene/);
  assert.match(source("app/editor/page.tsx"), /harmonizeAssetId=\{/);
  assert.match(source("lib/afc-v2-runtime/scene-persistence-client.ts"), /harmonizeAssetId/);
});

test("the experience does not write a room cover or a new AFC generation", () => {
  const files = [
    "lib/vibode-stage/harmonize-experience.ts",
    "components/stage/HarmonizeExperience.tsx",
    "app/api/vibode/harmonize/acknowledgement/route.ts",
  ].map(source).join("\n");
  assert.doesNotMatch(files, /cover_image_url|current_afc_generation_id|updateGeneration\(/);
  assert.doesNotMatch(files, /recoverHarmonizeGenerationHistory/);
});

test("provider success and History publication are different phases", () => {
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: job({ status: "succeeded", historyState: "pending" }),
  }), "publishing");
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: job({ status: "succeeded", historyState: "published" }),
  }), "published");
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: job({ status: "succeeded", historyState: "unavailable" }),
  }), "blocked");
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: job({ status: "failed", historyState: "pending" }),
  }), "failed");
  assert.equal(harmonizeButtonLabel("publishing"), "Not in History yet");
  assert.equal(harmonizeButtonLabel("blocked"), "History unavailable");
  assert.equal(harmonizePhaseBusy("publishing"), false);
  assert.equal(harmonizePhaseBusy("blocked"), false);
  assert.equal(harmonizePhaseBusy("running"), true);
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: job({ status: "succeeded", historyState: "pending" }),
  }), "publishing");
  assert.equal(harmonizeShouldSettlePublication({
    jobId: JOB,
    phase: "publishing",
    watchedJobId: JOB,
  }), false);
  assert.equal(harmonizeWatchJobId({
    jobId: JOB,
    phase: "blocked",
    watchedJobId: JOB,
  }), null);
  const background = harmonizeLiveBackgroundSha256(job(), {
    sourceVersionId: OTHER_SOURCE,
    afcGenerationId: GENERATION,
  });
  assert.equal(background, null);
});

test("the ten aspect-ratio families remain supported", () => {
  const families = [
    ["1:1", 1024, 1024],
    ["3:2", 1264, 848],
    ["2:3", 848, 1264],
    ["4:3", 1200, 896],
    ["3:4", 896, 1200],
    ["5:4", 1152, 928],
    ["4:5", 928, 1152],
    ["16:9", 1376, 768],
    ["9:16", 768, 1376],
    ["21:9", 1584, 672],
  ] as const;
  assert.equal(families.length, 10);
  for (const [ratio, width, height] of families) {
    const approved = harmonizeProviderAcceptsComposite(width, height);
    assert.equal(approved.ok && approved.aspectRatio, ratio);
  }
  const experience = source("lib/vibode-stage/harmonize-experience.ts");
  assert.doesNotMatch(experience, /2400|1792|4 \/ 3/);
});

test("status restores History identity without the prompt or scene blob", async () => {
  const objects = [{
    objectId: "UNIQUE_SCENE_OBJECT",
    assetId: "asset-1",
    transform: {
      position: { x: 1, y: 0, z: 2 },
      rotationDeg: { x: 0, y: 15, z: 0 },
      uniformScale: 1,
    },
  }];
  const view = harmonizeStatusFromRecord({
    id: JOB,
    status: "succeeded",
    requested_model_id: "gemini-3-pro-image",
    created_at: "2026-10-13T00:00:00.000Z",
    history_state: "published",
    output_asset_id: OUTPUT,
    output_active: false,
    room_id: ROOM,
    source_version_id: SOURCE,
    afc_generation_id: GENERATION,
    backdrop_kind: "afc_empty",
    background_sha256: SHA,
    scene_objects: objects,
    snapshot: { prompt: "UNIQUE_PROMPT_SENTINEL", roomScaleMultiplier: 1.25 },
    output_path: "rooms/secret.jpg",
  });
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /UNIQUE_PROMPT_SENTINEL|UNIQUE_SCENE_OBJECT|rooms\/secret\.jpg/);
  assert.equal(view?.historyState, "published");
  assert.equal(view?.outputActive, false);
  assert.equal(view?.roomScaleMultiplier, 1.25);
  assert.equal(view?.backdropKind, "afc_empty");
  assert.equal(view?.sceneObjectsSha256, await hashHarmonizeSceneObjects(objects));
  assert.equal(
    view?.sceneObjectsSha256,
    createHash("sha256").update(canonicalJson(objects)).digest("hex"),
  );
  assert.equal(view?.status, "succeeded");
  const restored = readHarmonizeExperienceJobRecord(view);
  assert.equal(harmonizeExperiencePhase({ submitting: false, job: restored }), "published");
  assert.equal(harmonizeExperiencePhase({
    submitting: false,
    job: restored ? { ...restored, historyState: "pending" } : null,
  }), "publishing");
});
