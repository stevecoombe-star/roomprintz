"use client";

import Image from "next/image";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  AFC_STATUS_LABELS,
  INITIAL_AFC_ORCHESTRATION_STATE,
  reduceAfcOrchestrationState,
} from "./orchestration-state";
import {
  REPRESENTATION_DESCRIPTIONS,
  REPRESENTATION_KINDS,
  REPRESENTATION_LABELS,
  createInitialRepresentationState,
  setEmptyRepresentation,
  setOriginalRepresentation,
  setTiledRepresentation,
} from "./representation-state";
import CalibratedRoomViewer from "./CalibratedRoomViewer";
import RoomEvidenceOverlay from "./RoomEvidenceOverlay";
import type {
  EmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  floorWallBoundaryStatusBySeamId,
  wallBaseDiagnosticsFromReceipt,
  type AfcV2RoomBoundaryAuthorityReceipt,
} from "./room-boundary-authority-contract";
import {
  AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
  roomCollisionQualificationBasisLabel,
  type AfcV2RoomCollisionAuthorityReceipt,
} from "./room-collision-authority-contract";
import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  type AfcV2EmptyOriginalRegistrationAuthorityReceipt,
} from "./empty-original-registration-authority-contract";
import {
  AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION,
  type AfcV2RoomEnvelopeAuthorityReceipt,
} from "./room-envelope-authority-contract";
import {
  AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION,
  selectActiveRuntimeCollisionWalls,
  type AfcV2RoomEnvelopeCollisionAuthorityReceipt,
} from "./room-envelope-collision-authority-contract";
import {
  AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION,
  activeRegistrationPath,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
} from "./original-structural-localization-authority-contract";
import {
  AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION,
  type AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt,
} from "./original-localized-boundary-authority-contract";
import {
  AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION,
  type AfcV2OriginalLocalizedCollisionAuthorityReceipt,
} from "./original-localized-collision-authority-contract";
import {
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
  type AfcV2EmptyAuthoritativeCollisionAuthorityReceipt,
} from "./empty-authoritative-collision-authority-contract";
import { deriveSceneMovementControlRange } from "./scene-movement-control-range";
import { TEST_CUBE_PLACEMENT_LOCAL_AABB, type LocalAabb } from "./room-collision-footprint";
import {
  USER_WORLD_SCALE_DEFAULT,
  USER_WORLD_SCALE_MAX,
  USER_WORLD_SCALE_MIN,
  USER_WORLD_SCALE_STEP,
  canonicalXzFromDisplayed,
  clampUserWorldScale,
  computeMetricScale,
  correctSceneLayerForWorldScaleChange,
  displayedXzFromCanonical,
  realizeCollisionWalls,
  realizeFloorRectangle,
  resolveCanonicalTransformInRealizedWorld,
} from "./scene-metric-world-realization";
import {
  formatCanonicalGaugeUnits,
  isMetricCorrespondenceSelection,
  metricCorrespondenceRoleCopy,
  type MetricCorrespondenceSelection,
} from "./metric-correspondence-span-contract";
import {
  formatCandidateMetricScale,
  isMetricCorrespondenceEstimateReceipt,
  metricCorrespondenceEstimateIsAccepted,
  METRIC_SPAN_ESTIMATE_NOT_APPLIED_COPY,
  METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY,
  METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY,
  METRIC_SPAN_ESTIMATE_NOT_RUN_COPY,
  type MetricCorrespondenceEstimateReceipt,
} from "./metric-correspondence-estimate-contract";
import {
  formatMetricMetres,
  isMetricRoomPriorReceipt,
  metricRoomPriorIsAccepted,
  METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY,
  METRIC_ROOM_PRIOR_NOT_APPLIED_COPY,
  METRIC_ROOM_PRIOR_UNRELIABLE_COPY,
  type MetricRoomPriorReceipt,
} from "./metric-room-prior-contract";
import {
  AUTO_METRIC_GEMINI_AVAILABLE_COPY,
  AUTO_METRIC_LAB_TRUST_LABEL,
  AUTO_METRIC_NO_TRUSTED_SPAN_COPY,
  AUTO_METRIC_SCALE_EXPERIMENTAL_COPY,
  AUTO_METRIC_SCALE_SOURCE_COPY,
  AUTO_METRIC_UNRELIABLE_COPY,
  formatAutoMetricScale,
} from "./metric-auto-scale-contract";
import { deriveAutoMetricScale } from "./metric-auto-scale";
import {
  DEFAULT_SHOW_COLLISION_BOUNDARY,
  DEFAULT_SHOW_FLOOR_QUAD,
  DEFAULT_SHOW_WALL_BOUNDARY,
  SCENE_TRANSFORM_LIMITS,
  addGlbModel,
  addTestCube,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  sceneObjectBlobUrls,
  selectSceneObject,
  setSceneObjectLoadStatus,
  setViewportTransformMode,
  applyObjectWorldTransform,
  blobUrlOwnedSolelyByObject,
  deleteSceneObject,
  updateSelectedPositionAxis,
  updateSelectedRotationAxis,
  updateSelectedUniformScale,
  type SceneLayerState,
  type SceneObjectLoadStatus,
} from "./scene-layer-state";

type OriginalBasis = {
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  encodedOrientation: 1;
};

type AppliedAfcResult = {
  floor: {
    authorityKey: string;
    sourceNormalizedPolygon: readonly { x: number; y: number }[];
    worldWidthM: number;
    referenceDepthM: number;
    widthDepthRatio: number;
  };
  camera: {
    verticalFovDeg: number;
    originalBasisRestored: true;
    frame: { width: number; height: number };
    pose: {
      position: { x: number; y: number; z: number };
      lookAt: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
    };
  };
  tiled: {
    imageUrl: string;
    identity: {
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
    };
    provenance: {
      generatedFrom: "EMPTY";
      parentEmptySha256: string;
      originalAncestorSha256: string;
      lineageEvidenceDigest: string | null;
      generatorId: string;
      profileId: string;
      researchPreset: string;
    };
  } | null;
  empty: {
    imageUrl: string;
    identity: {
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
    };
    provenance: {
      generatedFrom: "ORIGINAL";
      parentOriginalSha256: string;
    };
  } | null;
  freezeReceipt: unknown;
  roomBoundaries: AfcV2RoomBoundaryAuthorityReceipt | null;
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
  emptyOriginalRegistration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  roomEnvelope: AfcV2RoomEnvelopeAuthorityReceipt | null;
  roomEnvelopeCollision: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null;
  originalStructuralLocalization: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null;
  originalLocalizedBoundary: AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt | null;
  originalLocalizedCollision: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null;
  emptyAuthoritativeCollision: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null;
};

type PipelineEvidenceState = {
  empty: AppliedAfcResult["empty"];
  tiled: AppliedAfcResult["tiled"];
  roomObservation: EmptyRoomObservationEvidence | null;
  roomObservationStatus:
    | "observed"
    | "partial"
    | "failed"
    | "not_run_empty_unavailable";
  metricRoomPrior: MetricRoomPriorReceipt | null;
  metricCorrespondence: MetricCorrespondenceSelection | null;
  metricCorrespondenceEstimate: MetricCorrespondenceEstimateReceipt | null;
  analysisEvidence: unknown;
};

function isPreparedOriginal(
  value: unknown,
): value is { ok: true; basis: OriginalBasis } {
  return !!value && typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    !!(value as { basis?: unknown }).basis;
}

function isFloorAppliedAfcResult(value: unknown): value is {
  status: "applied" | "partial";
  reason?: string;
  floor: AppliedAfcResult["floor"];
  camera: AppliedAfcResult["camera"];
  tiled: AppliedAfcResult["tiled"];
  empty: AppliedAfcResult["empty"];
  product?: {
    emptyBasis?: {
      decodedWidth: number;
      decodedHeight: number;
    };
  };
  freezeReceipt: unknown;
  roomBoundaries?: unknown;
  roomCollision?: unknown;
  emptyOriginalRegistration?: unknown;
  roomEnvelope?: unknown;
  roomEnvelopeCollision?: unknown;
  originalStructuralLocalization?: unknown;
  originalLocalizedBoundary?: unknown;
  originalLocalizedCollision?: unknown;
  emptyAuthoritativeCollision?: unknown;
} {
  return !!value && typeof value === "object" &&
    ((value as { status?: unknown }).status === "applied" ||
      (value as { status?: unknown }).status === "partial") &&
    !!(value as { floor?: unknown }).floor &&
    !!(value as { camera?: unknown }).camera;
}

function asRoomBoundaryReceipt(
  value: unknown,
): AfcV2RoomBoundaryAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION
    ? value as AfcV2RoomBoundaryAuthorityReceipt
    : null;
}

function asRoomCollisionReceipt(
  value: unknown,
): AfcV2RoomCollisionAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION
    ? value as AfcV2RoomCollisionAuthorityReceipt
    : null;
}

function asRegistrationReceipt(
  value: unknown,
): AfcV2EmptyOriginalRegistrationAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION
    ? value as AfcV2EmptyOriginalRegistrationAuthorityReceipt
    : null;
}

function asRoomEnvelopeReceipt(
  value: unknown,
): AfcV2RoomEnvelopeAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION
    ? value as AfcV2RoomEnvelopeAuthorityReceipt
    : null;
}

function asRoomEnvelopeCollisionReceipt(
  value: unknown,
): AfcV2RoomEnvelopeCollisionAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION
    ? value as AfcV2RoomEnvelopeCollisionAuthorityReceipt
    : null;
}

function asOriginalStructuralLocalizationReceipt(
  value: unknown,
): AfcV2OriginalStructuralLocalizationAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ORIGINAL_STRUCTURAL_LOCALIZATION_AUTHORITY_VERSION
    ? value as AfcV2OriginalStructuralLocalizationAuthorityReceipt
    : null;
}

function asOriginalLocalizedBoundaryReceipt(
  value: unknown,
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION
    ? value as AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt
    : null;
}

function asOriginalLocalizedCollisionReceipt(
  value: unknown,
): AfcV2OriginalLocalizedCollisionAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION
    ? value as AfcV2OriginalLocalizedCollisionAuthorityReceipt
    : null;
}

function asEmptyAuthoritativeCollisionReceipt(
  value: unknown,
): AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null {
  return value &&
      typeof value === "object" &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION
    ? value as AfcV2EmptyAuthoritativeCollisionAuthorityReceipt
    : null;
}

function pipelineEvidence(value: unknown): PipelineEvidenceState {
  if (!value || typeof value !== "object") {
    return {
      empty: null,
      tiled: null,
      roomObservation: null,
      roomObservationStatus: "not_run_empty_unavailable",
      metricRoomPrior: null,
      metricCorrespondence: null,
      metricCorrespondenceEstimate: null,
      analysisEvidence: value,
    };
  }
  const candidate = value as {
    empty?: unknown;
    tiled?: unknown;
    roomObservation?: unknown;
    roomObservationStatus?: unknown;
    metricRoomPrior?: unknown;
    metricCorrespondence?: unknown;
    metricCorrespondenceEstimate?: unknown;
  };
  const empty = candidate.empty &&
      typeof candidate.empty === "object" &&
      typeof (candidate.empty as { imageUrl?: unknown }).imageUrl ===
        "string"
    ? candidate.empty as AppliedAfcResult["empty"]
    : null;
  const tiled = candidate.tiled &&
      typeof candidate.tiled === "object" &&
      typeof (candidate.tiled as { imageUrl?: unknown }).imageUrl === "string"
    ? candidate.tiled as AppliedAfcResult["tiled"]
    : null;
  const roomObservation = candidate.roomObservation &&
      typeof candidate.roomObservation === "object" &&
      ((candidate.roomObservation as { observerStatus?: unknown })
          .observerStatus === "observed" ||
        (candidate.roomObservation as { observerStatus?: unknown })
            .observerStatus === "partial" ||
        (candidate.roomObservation as { observerStatus?: unknown })
            .observerStatus === "failed")
    ? candidate.roomObservation as EmptyRoomObservationEvidence
    : null;
  const roomObservationStatus =
    candidate.roomObservationStatus === "observed" ||
      candidate.roomObservationStatus === "partial" ||
      candidate.roomObservationStatus === "failed"
      ? candidate.roomObservationStatus
      : "not_run_empty_unavailable";
  return {
    empty,
    tiled,
    roomObservation,
    roomObservationStatus,
    metricRoomPrior: isMetricRoomPriorReceipt(candidate.metricRoomPrior)
      ? candidate.metricRoomPrior
      : null,
    metricCorrespondence: isMetricCorrespondenceSelection(candidate.metricCorrespondence)
      ? candidate.metricCorrespondence
      : null,
    metricCorrespondenceEstimate:
      isMetricCorrespondenceEstimateReceipt(candidate.metricCorrespondenceEstimate)
        ? candidate.metricCorrespondenceEstimate
        : null,
    analysisEvidence: value,
  };
}

export function containedDisplayFrame(
  container: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }> | null,
): { width: number; height: number } {
  if (
    !source ||
    container.width <= 0 ||
    container.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return container;
  }
  const scale = Math.min(
    container.width / source.width,
    container.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function formatSelectedModelHeading(label: string | null): string {
  return `Selected Model — ${label ?? "None"}`;
}

function TransformControlRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isFinite(next)) return;
            onValue(next);
          }}
          className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[11px] text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:text-slate-600"
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValue(Number.parseFloat(event.target.value))}
        className="mt-1 w-full accent-cyan-400 disabled:cursor-not-allowed"
      />
    </label>
  );
}

export default function RoomLabV2() {
  const [representations, setRepresentations] = useState(
    createInitialRepresentationState,
  );
  const [orchestration, dispatch] = useReducer(
    reduceAfcOrchestrationState,
    INITIAL_AFC_ORCHESTRATION_STATE,
  );
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [preparedImageUrl, setPreparedImageUrl] = useState<string | null>(null);
  const [basis, setBasis] = useState<OriginalBasis | null>(null);
  const [applied, setApplied] = useState<AppliedAfcResult | null>(null);
  const [pipeline, setPipeline] = useState<PipelineEvidenceState | null>(null);
  const [showRoomObservationOverlay, setShowRoomObservationOverlay] =
    useState(true);
  const [showRoomObservationLegend, setShowRoomObservationLegend] =
    useState(true);
  const [showRegistrationCorrespondences, setShowRegistrationCorrespondences] =
    useState(true);
  const [showOriginalLocalization, setShowOriginalLocalization] = useState(true);
  const [showFloorQuad, setShowFloorQuad] = useState(DEFAULT_SHOW_FLOOR_QUAD);
  const [showWallBoundary, setShowWallBoundary] = useState(
    DEFAULT_SHOW_WALL_BOUNDARY,
  );
  const [showCollisionBoundary, setShowCollisionBoundary] = useState(
    DEFAULT_SHOW_COLLISION_BOUNDARY,
  );
  const [sceneLayer, setSceneLayer] = useState(createInitialSceneLayerState);
  const [selectedModelExpanded, setSelectedModelExpanded] = useState(false);
  const [userWorldScale, setUserWorldScale] = useState(USER_WORLD_SCALE_DEFAULT);
  const [
    trustSelectedBackSpanAsFullWidth,
    setTrustSelectedBackSpanAsFullWidth,
  ] = useState(false);
  const [viewportInteractionActive, setViewportInteractionActive] = useState(false);
  const [worldScaleInputCaptured, setWorldScaleInputCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerFrame, setViewerFrame] = useState({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const sceneLayerRef = useRef(sceneLayer);
  const objectLocalAabbRef = useRef(new Map<string, LocalAabb>());
  const activeCollisionRef = useRef(selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: null,
    envelopeCollision: null,
    roomCollision: null,
  }));
  const acceptedMetricPrior = metricRoomPriorIsAccepted(pipeline?.metricRoomPrior)
    ? pipeline?.metricRoomPrior ?? null
    : null;
  const metricPriorDepth = acceptedMetricPrior?.estimate?.estimatedRoomDepthM ?? null;
  const metricPriorWidth = acceptedMetricPrior?.estimate?.estimatedRoomWidthM ?? null;
  const metricPriorCeiling = acceptedMetricPrior?.estimate?.estimatedCeilingHeightM ?? null;
  const metricPriorConfidence = acceptedMetricPrior?.estimate?.modelConfidence ?? null;
  const selectedMetricSpan = pipeline?.metricCorrespondence?.selected ?? null;
  const matchedS4aCandidate = selectedMetricSpan?.lineage.s4aCandidateId
    ? applied?.roomBoundaries?.candidates.find(
        (candidate) =>
          candidate.id === selectedMetricSpan.lineage.s4aCandidateId,
      ) ?? null
    : null;
  const autoMetricReceipt = deriveAutoMetricScale({
    roomPrior: pipeline?.metricRoomPrior ?? null,
    selected: selectedMetricSpan,
    s4aSafety: matchedS4aCandidate
      ? {
          observedSpanOnly: matchedS4aCandidate.limitations.observedSpanOnly,
          hiddenContinuation: matchedS4aCandidate.limitations.hiddenContinuation,
          geometryManufactured: matchedS4aCandidate.limitations.geometryManufactured,
        }
      : null,
    trustSelectedBackSpanAsFullWidth,
  });
  const autoMetricScale = autoMetricReceipt.autoMetricScale;
  const metricScale = computeMetricScale(autoMetricScale, userWorldScale);
  const metricScaleRef = useRef(metricScale);
  metricScaleRef.current = metricScale;
  const previousMetricScaleRef = useRef(metricScale);
  const loadGenerationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const selectedRepresentation =
    representations[orchestration.selectedRepresentation];
  const originalAvailable =
    representations.ORIGINAL.availability === "available" && basis !== null;
  const originalDisplayFrame = containedDisplayFrame(
    viewerFrame,
    basis
      ? { width: basis.decodedWidth, height: basis.decodedHeight }
      : null,
  );
  const selectedImageSize = orchestration.selectedRepresentation ===
      "TILED" && pipeline?.tiled
    ? {
      width: pipeline.tiled.identity.decodedWidth,
      height: pipeline.tiled.identity.decodedHeight,
    }
    : orchestration.selectedRepresentation === "EMPTY" &&
        pipeline?.empty
    ? {
      width: pipeline.empty.identity.decodedWidth,
      height: pipeline.empty.identity.decodedHeight,
    }
    : basis
    ? { width: basis.decodedWidth, height: basis.decodedHeight }
    : null;
  const displayFrame = containedDisplayFrame(
    viewerFrame,
    selectedImageSize,
  );
  const selectedSceneObject = getSelectedSceneObject(sceneLayer);
  const sceneControlsEnabled = Boolean(applied);

  function resetSceneLayer(next: SceneLayerState = createInitialSceneLayerState()) {
    for (const url of sceneObjectBlobUrls(sceneLayerRef.current)) {
      URL.revokeObjectURL(url);
    }
    objectLocalAabbRef.current.clear();
    sceneLayerRef.current = next;
    setSceneLayer(next);
  }

  function reportObjectLocalAabb(objectId: string, aabb: LocalAabb | null) {
    if (!aabb) {
      objectLocalAabbRef.current.delete(objectId);
      return;
    }
    objectLocalAabbRef.current.set(objectId, aabb);
  }

  function localAabbForObject(object: SceneLayerState["objects"][number]): LocalAabb | null {
    return objectLocalAabbRef.current.get(object.id) ??
      (object.kind === "test_cube" ? TEST_CUBE_PLACEMENT_LOCAL_AABB : null);
  }

  function applyCollisionAwareTransform(
    current: SceneLayerState,
    objectId: string,
    proposed: SceneLayerState["objects"][number]["transform"],
    mode: "move" | "pose",
  ): SceneLayerState {
    const object = current.objects.find((item) => item.id === objectId);
    if (!object) return current;
    // Host and viewer both call resolveSceneObjectCollision in realized metres.
    const resolved = resolveCanonicalTransformInRealizedWorld({
      currentCanonical: object.transform,
      proposedCanonical: proposed,
      localAabb: localAabbForObject(object),
      canonicalWalls: activeCollisionRef.current.walls,
      metricScale: metricScaleRef.current,
      mode,
    });
    return applyObjectWorldTransform(current, objectId, resolved);
  }

  function reportObjectLoadStatus(
    objectId: string,
    loadStatus: SceneObjectLoadStatus,
    loadError: string | null = null,
  ) {
    setSceneLayer((current) =>
      setSceneObjectLoadStatus(current, objectId, loadStatus, loadError)
    );
  }

  function reportSelection(objectId: string | null) {
    setSceneLayer((current) => selectSceneObject(current, objectId));
  }

  function reportObjectTransform(
    objectId: string,
    transform: SceneLayerState["objects"][number]["transform"],
  ) {
    setSceneLayer((current) =>
      applyObjectWorldTransform(current, objectId, transform)
    );
  }

  function handleResetSelectedTransform() {
    setSceneLayer((current) => {
      const selected = getSelectedSceneObject(current);
      if (!selected) return current;
      return applyCollisionAwareTransform(
        current,
        selected.id,
        selected.initialTransform,
        "pose",
      );
    });
  }

  function handleDeleteSelectedObject() {
    const current = sceneLayerRef.current;
    const selected = getSelectedSceneObject(current);
    if (!selected) return;
    const urlToRevoke = blobUrlOwnedSolelyByObject(current, selected);
    objectLocalAabbRef.current.delete(selected.id);
    const next = deleteSceneObject(current, selected.id);
    sceneLayerRef.current = next;
    setSceneLayer(next);
    if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
  }

  function handleGlbFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !sceneControlsEnabled) return;
    const objectUrl = URL.createObjectURL(file);
    setSceneLayer((current) =>
      addGlbModel(current, { objectUrl, fileName: file.name })
    );
    if (glbInputRef.current) glbInputRef.current.value = "";
  }

  const activeCollision = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: applied?.emptyAuthoritativeCollision ?? null,
    originalLocalizedCollision: applied?.originalLocalizedCollision ?? null,
    envelopeCollision: applied?.roomEnvelopeCollision ?? null,
    roomCollision: applied?.roomCollision ?? null,
  });
  const realizedFloor = applied
    ? realizeFloorRectangle(applied.floor, metricScale)
    : null;
  const realizedCollisionWalls = realizeCollisionWalls(
    activeCollision.walls,
    metricScale,
  );
  const movementControlRange = deriveSceneMovementControlRange({
    floor: realizedFloor,
    collisionWalls: realizedCollisionWalls,
  });
  const registrationPath = activeRegistrationPath({
    identityRegistrationClass: applied?.emptyOriginalRegistration?.registrationClass,
    originalLocalizationClass: applied?.originalStructuralLocalization?.registrationClass,
  });

  useEffect(() => {
    sceneLayerRef.current = sceneLayer;
  }, [sceneLayer]);

  useEffect(() => {
    metricScaleRef.current = metricScale;
  }, [metricScale]);

  useEffect(() => {
    if (!worldScaleInputCaptured) return;
    const release = () => setWorldScaleInputCaptured(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [worldScaleInputCaptured]);

  useEffect(() => {
    activeCollisionRef.current = activeCollision;
  }, [activeCollision]);

  useEffect(() => {
    const previous = previousMetricScaleRef.current;
    previousMetricScaleRef.current = metricScale;
    if (!(metricScale < previous)) return;
    setSceneLayer((current) =>
      correctSceneLayerForWorldScaleChange({
        state: current,
        previousMetricScale: previous,
        nextMetricScale: metricScale,
        canonicalWalls: activeCollisionRef.current.walls,
        localAabbFor: (object) => localAabbForObject(object),
      })
    );
  }, [metricScale]);

  useEffect(() => {
    return () => {
      for (const url of sceneObjectBlobUrls(sceneLayerRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const update = () =>
      setViewerFrame({
        width: Math.round(viewer.clientWidth),
        height: Math.round(viewer.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  async function prepareOriginal() {
    const requestedUrl = sourceImageUrl.trim();
    if (!requestedUrl) return;
    const imageUrl = new URL(requestedUrl, window.location.origin).toString();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    setBasis(null);
    setPreparedImageUrl(null);
    setApplied(null);
    setPipeline(null);
    resetSceneLayer();
    setUserWorldScale(USER_WORLD_SCALE_DEFAULT);
    setTrustSelectedBackSpanAsFullWidth(false);
    setShowFloorQuad(DEFAULT_SHOW_FLOOR_QUAD);
    setError(null);
    dispatch({ type: "original_preparation_started" });
    try {
      const response = await fetch("/api/admin/3d-room-lab-v2/prepare-original", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ sourceImageUrl: imageUrl }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      if (!response.ok || !isPreparedOriginal(result)) {
        throw new Error("The Original could not be authority-qualified.");
      }
      setBasis(result.basis);
      setPreparedImageUrl(imageUrl);
      setRepresentations((current) =>
        setOriginalRepresentation(current, {
          imageUrl,
          source: { type: "hosted-url", imageUrl },
        }),
      );
      dispatch({ type: "original_ready" });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Original preparation failed.");
      dispatch({ type: "analysis_failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function analyzeAndApply(
    analysisIntent: Readonly<{ forceTiledRegeneration?: boolean }> = {},
  ) {
    if (
      !basis ||
      !preparedImageUrl ||
      !originalAvailable ||
      originalDisplayFrame.width <= 0 ||
      originalDisplayFrame.height <= 0
    ) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = loadGenerationRef.current;
    const attemptId = `afc-v2-${window.crypto.randomUUID()}`;
    setApplied(null);
    setPipeline(null);
    setError(null);
    dispatch({ type: "analysis_stage", status: "generating_empty" });
    try {
      const response = await fetch("/api/admin/3d-room-lab-v2/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          attemptId,
          sourceImageUrl: preparedImageUrl,
          sourceImageIdentity: {
            sha256: basis.basisFingerprint,
            decodedWidth: basis.decodedWidth,
            decodedHeight: basis.decodedHeight,
            orientation: basis.encodedOrientation,
          },
          loadGeneration: generation,
          frame: originalDisplayFrame,
          referenceDepthM: 4,
          forceTiledRegeneration: analysisIntent.forceTiledRegeneration === true,
        }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      const receivedPipeline = pipelineEvidence(result);
      setPipeline(receivedPipeline);
      setRepresentations((current) => {
        let next = current;
        if (receivedPipeline.empty) {
          next = setEmptyRepresentation(next, receivedPipeline.empty.imageUrl);
        }
        if (receivedPipeline.tiled) {
          next = setTiledRepresentation(
            next,
            receivedPipeline.tiled.imageUrl,
          );
        }
        return next;
      });
      if (!response.ok || !isFloorAppliedAfcResult(result)) {
        const reason = result && typeof result === "object" &&
          typeof (result as { reason?: unknown }).reason === "string"
          ? (result as { reason: string }).reason
          : "Certified floor AFC could not be applied.";
        throw new Error(reason);
      }
      dispatch({ type: "analysis_stage", status: "reading_floor" });
      dispatch({ type: "analysis_stage", status: "calibrating_camera" });
      if (receivedPipeline.roomObservation) {
        dispatch({ type: "analysis_stage", status: "observing_room" });
      }
      setApplied({
        floor: result.floor,
        camera: result.camera,
        tiled: result.tiled,
        empty: result.empty,
        freezeReceipt: result.freezeReceipt,
        roomBoundaries: asRoomBoundaryReceipt(result.roomBoundaries),
        roomCollision: asRoomCollisionReceipt(result.roomCollision),
        emptyOriginalRegistration: asRegistrationReceipt(
          result.emptyOriginalRegistration,
        ),
        roomEnvelope: asRoomEnvelopeReceipt(result.roomEnvelope),
        roomEnvelopeCollision: asRoomEnvelopeCollisionReceipt(
          result.roomEnvelopeCollision,
        ),
        originalStructuralLocalization: asOriginalStructuralLocalizationReceipt(
          result.originalStructuralLocalization,
        ),
        originalLocalizedBoundary: asOriginalLocalizedBoundaryReceipt(
          result.originalLocalizedBoundary,
        ),
        originalLocalizedCollision: asOriginalLocalizedCollisionReceipt(
          result.originalLocalizedCollision,
        ),
        emptyAuthoritativeCollision: asEmptyAuthoritativeCollisionReceipt(
          result.emptyAuthoritativeCollision,
        ),
      });
      dispatch({ type: "analysis_applied" });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "AFC analysis failed.");
      dispatch({ type: "analysis_failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function downloadAnalysisEvidence() {
    if (!pipeline?.analysisEvidence) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.analysisEvidence, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s3c-floor-camera-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomObservationEvidence() {
    if (!pipeline?.roomObservation) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.roomObservation, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s3d-empty-room-observation-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomCollisionEvidence() {
    if (!applied?.roomCollision) return;
    const blob = new Blob(
      [JSON.stringify(applied.roomCollision, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4b-room-collision-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomBoundaryEvidence() {
    if (!applied?.roomBoundaries) return;
    const blob = new Blob(
      [JSON.stringify(applied.roomBoundaries, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4a-room-boundary-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRegistrationEvidence() {
    if (!applied?.emptyOriginalRegistration) return;
    const blob = new Blob(
      [JSON.stringify(applied.emptyOriginalRegistration, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c0-empty-original-registration-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomEnvelopeEvidence() {
    if (!applied?.roomEnvelope) return;
    const blob = new Blob(
      [JSON.stringify(applied.roomEnvelope, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c1-room-envelope-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomEnvelopeCollisionEvidence() {
    if (!applied?.roomEnvelopeCollision) return;
    const blob = new Blob(
      [JSON.stringify(applied.roomEnvelopeCollision, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c-cq-room-envelope-collision-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadOriginalLocalizationEvidence() {
    if (!applied?.originalStructuralLocalization) return;
    const blob = new Blob(
      [JSON.stringify(applied.originalStructuralLocalization, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c0-ol-original-structural-localization-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadOriginalLocalizedBoundaryEvidence() {
    if (!applied?.originalLocalizedBoundary) return;
    const blob = new Blob(
      [JSON.stringify(applied.originalLocalizedBoundary, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c0-ol-original-localized-boundary-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadOriginalLocalizedCollisionEvidence() {
    if (!applied?.originalLocalizedCollision) return;
    const blob = new Blob(
      [JSON.stringify(applied.originalLocalizedCollision, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s4c-ol-original-localized-collision-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadEmptyAuthoritativeCollisionEvidence() {
    if (!applied?.emptyAuthoritativeCollision) return;
    const blob = new Blob(
      [JSON.stringify(applied.emptyAuthoritativeCollision, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-empty-authoritative-collision-authority.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMetricRoomPriorEvidence() {
    if (!pipeline?.metricRoomPrior) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.metricRoomPrior, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-metric-room-prior-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMetricCorrespondenceEvidence() {
    if (!pipeline?.metricCorrespondence) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.metricCorrespondence, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-metric-correspondence-selection.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMetricCorrespondenceEstimateEvidence() {
    if (!pipeline?.metricCorrespondenceEstimate) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.metricCorrespondenceEstimate, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-metric-correspondence-estimate.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadAutoMetricScaleEvidence() {
    const blob = new Blob(
      [JSON.stringify(autoMetricReceipt, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-auto-metric-scale.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-cyan-200">
                AFC V2 · S4B
              </span>
              <span className="text-xs text-slate-500">
                Frozen Floor/Camera + S4A wall-base diagnostics + S4B collision qualification
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              3D Room Lab v2
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              EMPTY now supplies conservative visible-room observation
              evidence while its TILED child remains the sole Floor and Camera
              authority path. Scene objects render under that frozen camera
              and never write it.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="url"
              value={sourceImageUrl}
              onChange={(event) => setSourceImageUrl(event.target.value)}
              placeholder="https://…/original.jpg"
              aria-label="Original room image URL"
              className="min-w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => void prepareOriginal()}
              disabled={!sourceImageUrl.trim()}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              Prepare Original
            </button>
            <button
              type="button"
              disabled={!originalAvailable}
              onClick={() => void analyzeAndApply()}
              className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              title={
                originalAvailable
                  ? "Run certified floor AFC"
                  : "Prepare an Original room image first"
              }
            >
              Analyze &amp; Apply AFC
            </button>
            <button
              type="button"
              disabled={!originalAvailable}
              onClick={() => void analyzeAndApply({ forceTiledRegeneration: true })}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
              title="Re-read the room perspective if the 3D view doesn’t line up well with the photo."
            >
              Re-read Room Perspective
            </button>
          </div>
        </header>

        <section
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
          aria-label="AFC v2 workspace"
        >
          <div className="flex min-w-0 flex-col gap-3">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div
                className="flex flex-wrap gap-1"
                role="tablist"
                aria-label="Room representations"
              >
                {REPRESENTATION_KINDS.map((kind) => {
                  const active =
                    orchestration.selectedRepresentation === kind;
                  const available =
                    representations[kind].availability === "available";
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() =>
                        dispatch({
                          type: "representation_selected",
                          representation: kind,
                        })
                      }
                      className={`rounded-md px-3 py-2 text-xs font-semibold tracking-wide transition ${
                        active
                          ? "bg-slate-700 text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {REPRESENTATION_LABELS[kind]}
                      {!available && kind !== "ORIGINAL" ? (
                        <span className="ml-2 text-slate-600">—</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                {orchestration.selectedRepresentation === "EMPTY" &&
                    pipeline?.roomObservation &&
                    pipeline.roomObservation.observerStatus !== "failed" ? (
                  <>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={showRoomObservationOverlay}
                        onChange={(event) =>
                          setShowRoomObservationOverlay(event.target.checked)}
                        className="accent-cyan-400"
                      />
                      Observation overlay
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={showRoomObservationLegend}
                        onChange={(event) =>
                          setShowRoomObservationLegend(event.target.checked)}
                        className="accent-cyan-400"
                      />
                      Legend
                    </label>
                  </>
                ) : null}
                {applied?.emptyOriginalRegistration?.correspondences.length ? (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={showRegistrationCorrespondences}
                      onChange={(event) =>
                        setShowRegistrationCorrespondences(event.target.checked)}
                      className="accent-teal-400"
                    />
                    Registration evidence (diagnostic only)
                    {applied.emptyOriginalRegistration.anchorCount > 0 ||
                        applied.emptyOriginalRegistration.ridgeStructureCount > 0
                      ? ` · ${applied.emptyOriginalRegistration.anchorInlierCount}A/${applied.emptyOriginalRegistration.ridgeInlierCount}R`
                      : ""}
                  </label>
                ) : null}
                {applied?.originalStructuralLocalization?.structures.length ? (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={showOriginalLocalization}
                      onChange={(event) =>
                        setShowOriginalLocalization(event.target.checked)}
                      className="accent-violet-400"
                    />
                    ORIGINAL localization (diagnostic only)
                  </label>
                ) : null}
                <span className="text-xs text-slate-500">
                  {REPRESENTATION_DESCRIPTIONS[
                    orchestration.selectedRepresentation
                  ]}
                </span>
              </div>
            </div>

            <div
              ref={viewerRef}
              className="relative flex min-h-[440px] items-center justify-center bg-black/40 lg:min-h-[620px]"
              role="tabpanel"
              aria-label={`${REPRESENTATION_LABELS[orchestration.selectedRepresentation]} viewer`}
            >
              {selectedRepresentation.availability === "available" ? (
                <div
                  className="relative overflow-hidden bg-black"
                  style={{
                    width: displayFrame.width,
                    height: displayFrame.height,
                  }}
                >
                  {orchestration.selectedRepresentation === "ORIGINAL" &&
                  applied ? (
                    <CalibratedRoomViewer
                      originalImageUrl={selectedRepresentation.imageUrl}
                      camera={applied.camera}
                      floor={{
                        worldWidthM: applied.floor.worldWidthM,
                        referenceDepthM: applied.floor.referenceDepthM,
                      }}
                      showFloorQuad={showFloorQuad}
                      showWallBoundary={showWallBoundary}
                      showCollisionBoundary={showCollisionBoundary}
                      wallBaseDiagnostics={wallBaseDiagnosticsFromReceipt(
                        applied.roomBoundaries,
                      )}
                      collisionWallDiagnostics={activeCollision.diagnostics}
                      collisionWalls={activeCollision.walls}
                      collisionWallColor={activeCollision.source === "empty_authoritative"
                        ? 0xf97316
                        : activeCollision.source === "ol_cq"
                        ? 0xa78bfa
                        : activeCollision.source === "s4c_cq"
                        ? 0x2dd4bf
                        : 0xf43f5e}
                      sceneObjects={sceneLayer.objects}
                      selectedObjectId={sceneLayer.selectedObjectId}
                      transformMode={sceneLayer.transformMode}
                      metricScale={metricScale}
                      worldScaleInputCaptured={worldScaleInputCaptured}
                      reportObjectLoadStatus={reportObjectLoadStatus}
                      reportSelection={reportSelection}
                      reportObjectTransform={reportObjectTransform}
                      reportObjectLocalAabb={reportObjectLocalAabb}
                      reportViewportInteraction={setViewportInteractionActive}
                    />
                  ) : (
                    <Image
                      src={selectedRepresentation.imageUrl}
                      alt={`${REPRESENTATION_LABELS[orchestration.selectedRepresentation]} room representation`}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  )}
                  {selectedRepresentation.source ? (
                    <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
                      Original · authority-qualified
                    </div>
                  ) : null}
                  {applied || pipeline?.roomObservation ? (
                    <RoomEvidenceOverlay
                      floorPolygon={applied?.floor.sourceNormalizedPolygon ?? []}
                      roomObservation={pipeline?.roomObservation ?? null}
                      showFloorAuthority={
                        Boolean(applied) &&
                        orchestration.selectedRepresentation === "TILED" &&
                        showFloorQuad
                      }
                      showRoomObservation={
                        showRoomObservationOverlay &&
                        orchestration.selectedRepresentation === "EMPTY"
                      }
                      showObservationLegend={showRoomObservationLegend}
                      floorWallBoundaryStatusBySeamId={
                        floorWallBoundaryStatusBySeamId(
                          applied?.roomBoundaries ?? null,
                        )
                      }
                      registrationCorrespondences={
                        showRegistrationCorrespondences &&
                          orchestration.selectedRepresentation === "EMPTY"
                          ? applied?.emptyOriginalRegistration?.correspondences ??
                            []
                          : []
                      }
                      overlaySpace={
                        orchestration.selectedRepresentation === "ORIGINAL"
                          ? "original"
                          : orchestration.selectedRepresentation === "EMPTY"
                          ? "empty"
                          : "none"
                      }
                      originalLocalizationStructures={
                        showOriginalLocalization &&
                          orchestration.selectedRepresentation === "ORIGINAL"
                          ? applied?.originalStructuralLocalization?.structures ??
                            []
                          : []
                      }
                      metricCorrespondenceSpan={
                        orchestration.selectedRepresentation === "ORIGINAL" &&
                          pipeline?.metricCorrespondence?.selected
                            ?.overlaySafeOnOriginal
                          ? pipeline.metricCorrespondence.selected
                          : null
                      }
                    />
                  ) : null}
                </div>
              ) : (
                <div className="max-w-md px-8 text-center">
                  <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-500">
                    —
                  </div>
                  <h2 className="text-base font-semibold text-slate-200">
                    {
                      REPRESENTATION_LABELS[
                        orchestration.selectedRepresentation
                      ]
                    }{" "}
                    is unavailable
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {selectedRepresentation.reason}
                  </p>
                </div>
              )}
            </div>
          </div>

          <section className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="text-sm font-semibold text-slate-200">
              Scene / Models
            </h2>
            <p className="mt-2 text-[11px] leading-4 text-slate-600">
              Object scene layer. Renders under the frozen camera. Does not
              write Floor, Camera, or EMPTY observation.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={!sceneControlsEnabled}
                onClick={() =>
                  setSceneLayer((current) => {
                    const next = addTestCube(current);
                    const id = next.selectedObjectId;
                    if (id) {
                      objectLocalAabbRef.current.set(
                        id,
                        TEST_CUBE_PLACEMENT_LOCAL_AABB,
                      );
                    }
                    return next;
                  })}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600 sm:min-w-[10rem] sm:flex-1"
              >
                Add Test Cube
              </button>
              <button
                type="button"
                disabled={!sceneControlsEnabled}
                onClick={() => glbInputRef.current?.click()}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600 sm:min-w-[10rem] sm:flex-1"
              >
                Load Model / GLB
              </button>
              <input
                ref={glbInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                aria-label="Load Model / GLB"
                onChange={(event) => handleGlbFile(event.target.files)}
              />
            </div>
            {sceneLayer.objects.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {sceneLayer.objects.map((object) => (
                  <li key={object.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSceneLayer((current) =>
                          selectSceneObject(current, object.id)
                        )}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
                        sceneLayer.selectedObjectId === object.id
                          ? "bg-slate-700 text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {object.label}
                      {object.kind === "glb"
                        ? ` · ${object.loadStatus}`
                        : ""}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
              {(["move", "rotate", "scale"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!sceneControlsEnabled}
                  aria-pressed={sceneLayer.transformMode === mode}
                  onClick={() =>
                    setSceneLayer((current) =>
                      setViewportTransformMode(current, mode)
                    )
                  }
                  className={`min-w-[4.5rem] flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize ${
                    sceneLayer.transformMode === mode
                      ? "bg-cyan-400 text-slate-950"
                      : "border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  } disabled:cursor-not-allowed disabled:text-slate-600`}
                >
                  {mode === "move" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"}
                </button>
              ))}
            </div>
            {selectedSceneObject ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!sceneControlsEnabled}
                  onClick={handleResetSelectedTransform}
                  className="min-w-[9rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  Reset Transform
                </button>
                <button
                  type="button"
                  disabled={!sceneControlsEnabled}
                  onClick={handleDeleteSelectedObject}
                  className="min-w-[9rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  Delete Object
                </button>
              </div>
            ) : null}
          </section>
          </div>

          <aside className="flex flex-col gap-3" aria-label="AFC architecture status">
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-100">
                  AFC Status
                </h2>
                <span className="size-2 rounded-full bg-cyan-300" />
              </div>
              <p
                className="mt-3 text-sm font-medium text-cyan-100"
                aria-live="polite"
              >
                {AFC_STATUS_LABELS[orchestration.status]}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {error ?? "The result is bound to the accepted Original basis."}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Floor</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {applied
                  ? `Calibrated · width ${realizedFloor?.worldWidthM.toFixed(2)} m · reference depth ${realizedFloor?.referenceDepthM.toFixed(2)} m · ratio ${applied.floor.widthDepthRatio.toFixed(3)} · world scale ${metricScale.toFixed(2)}×`
                  : "No calibrated Floor authority."}
              </p>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showFloorQuad}
                  disabled={!applied}
                  onChange={(event) => setShowFloorQuad(event.target.checked)}
                  className="accent-cyan-400"
                  aria-label="Show Floor Quad"
                />
                Show Floor Quad
              </label>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Diagnostic visibility only. Authority, Apply, freeze, and
                restore are unchanged.
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Lineage</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {pipeline?.empty && pipeline.tiled
                  ? `Original ${pipeline.empty.provenance.parentOriginalSha256.slice(0, 10)}… → EMPTY ${pipeline.empty.identity.sha256.slice(0, 10)}… → TILED ${pipeline.tiled.identity.sha256.slice(0, 10)}…`
                  : pipeline?.empty
                  ? `Original ${pipeline.empty.provenance.parentOriginalSha256.slice(0, 10)}… → EMPTY ${pipeline.empty.identity.sha256.slice(0, 10)}…`
                  : "Awaiting Original → EMPTY → TILED evidence."}
              </p>
              {pipeline?.tiled ? (
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Full-raster certified tiled-perspective reader
                </p>
              ) : null}
            </section>
            {applied ? (
              <button
                type="button"
                onClick={downloadAnalysisEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-cyan-200 transition hover:border-slate-500"
              >
                Download V2-S3C Floor/Camera evidence
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Camera</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {applied
                  ? `Calibrated · ${applied.camera.verticalFovDeg.toFixed(1)}° FOV · applied and frozen`
                    + " · Original identity restored"
                  : "No calibrated camera."}
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">World Scale</h2>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {metricScale.toFixed(2)}×
                <span className="ml-2 text-slate-600">
                  Auto {autoMetricScale.toFixed(2)}×
                </span>
              </p>
              <label className="mt-3 block">
                <span className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  Scale
                  <input
                    type="number"
                    min={USER_WORLD_SCALE_MIN}
                    max={USER_WORLD_SCALE_MAX}
                    step={USER_WORLD_SCALE_STEP}
                    value={userWorldScale}
                    disabled={!applied || viewportInteractionActive}
                    aria-label="World Scale"
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setUserWorldScale(clampUserWorldScale(next));
                    }}
                    onPointerDown={() => setWorldScaleInputCaptured(true)}
                    onPointerUp={() => setWorldScaleInputCaptured(false)}
                    onPointerCancel={() => setWorldScaleInputCaptured(false)}
                    className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[11px] text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:text-slate-600"
                  />
                </span>
                <input
                  type="range"
                  min={USER_WORLD_SCALE_MIN}
                  max={USER_WORLD_SCALE_MAX}
                  step={USER_WORLD_SCALE_STEP}
                  value={userWorldScale}
                  disabled={!applied || viewportInteractionActive}
                  aria-label="World Scale slider"
                  onChange={(event) =>
                    setUserWorldScale(clampUserWorldScale(Number.parseFloat(event.target.value)))}
                  onPointerDown={() => setWorldScaleInputCaptured(true)}
                  onPointerUp={() => setWorldScaleInputCaptured(false)}
                  onPointerCancel={() => setWorldScaleInputCaptured(false)}
                  className="mt-1 w-full accent-cyan-400 disabled:cursor-not-allowed"
                />
              </label>
              <button
                type="button"
                disabled={!applied || viewportInteractionActive}
                onClick={() => setUserWorldScale(USER_WORLD_SCALE_DEFAULT)}
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
              >
                Reset to Auto
              </button>
              <p className="mt-2 text-[11px] leading-4 text-slate-600">
                Scales the realized room, camera translation, and object
                X/Z placement. Authored object size is unchanged.
              </p>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <h3 className="text-xs font-semibold text-slate-300">
                  Room Size Prior
                </h3>
                {acceptedMetricPrior && metricPriorWidth ? (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>
                      Approx. width: {formatMetricMetres(metricPriorWidth.best)}
                    </p>
                    <p>
                      Width range: {metricPriorWidth.low.toFixed(1)}–
                      {metricPriorWidth.high.toFixed(1)} m
                    </p>
                    {metricPriorDepth ? (
                      <>
                        <p className="pt-2">
                          Approx. depth: {formatMetricMetres(metricPriorDepth.best)}
                        </p>
                        <p>
                          Depth range: {metricPriorDepth.low.toFixed(1)}–
                          {metricPriorDepth.high.toFixed(1)} m
                        </p>
                      </>
                    ) : null}
                    {metricPriorCeiling !== null ? (
                      <p className="pt-2">
                        Approx. ceiling: {formatMetricMetres(metricPriorCeiling)}
                      </p>
                    ) : null}
                    {metricPriorConfidence !== null ? (
                      <p className="pt-2">
                        Confidence: {metricPriorConfidence.toFixed(2)}
                      </p>
                    ) : null}
                    <p className="pt-2">
                      Status: {METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY}
                    </p>
                    {!autoMetricReceipt.accepted ? (
                      <p className="text-slate-600">
                        {METRIC_ROOM_PRIOR_NOT_APPLIED_COPY}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>{METRIC_ROOM_PRIOR_UNRELIABLE_COPY}</p>
                    <p className="text-slate-600">
                      {METRIC_ROOM_PRIOR_NOT_APPLIED_COPY}
                    </p>
                  </div>
                )}
                {pipeline?.metricRoomPrior ? (
                  <button
                    type="button"
                    onClick={downloadMetricRoomPriorEvidence}
                    className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:border-slate-500"
                  >
                    Download Metric Prior
                  </button>
                ) : null}
              </div>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <h3 className="text-xs font-semibold text-slate-300">
                  Auto Metric Scale
                </h3>
                {autoMetricReceipt.accepted ? (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>Source: {AUTO_METRIC_SCALE_SOURCE_COPY}</p>
                    {autoMetricReceipt.physicalSource ? (
                      <p>
                        Physical target:{" "}
                        {formatMetricMetres(autoMetricReceipt.physicalSource.metres)}
                      </p>
                    ) : null}
                    {autoMetricReceipt.canonicalSource ? (
                      <p>
                        Canonical span:{" "}
                        {formatCanonicalGaugeUnits(
                          autoMetricReceipt.canonicalSource.gaugeLength,
                        )}
                      </p>
                    ) : null}
                    <p>Auto: {formatAutoMetricScale(autoMetricScale)}</p>
                    <p>User World Scale: {formatAutoMetricScale(userWorldScale)}</p>
                    <p>Combined: {formatAutoMetricScale(metricScale)}</p>
                    <p>Status: {AUTO_METRIC_SCALE_EXPERIMENTAL_COPY}</p>
                  </div>
                ) : acceptedMetricPrior && metricPriorWidth ? (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>{AUTO_METRIC_GEMINI_AVAILABLE_COPY}</p>
                    <p>{AUTO_METRIC_NO_TRUSTED_SPAN_COPY}</p>
                    <p>Auto: {formatAutoMetricScale(autoMetricScale)}</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>{AUTO_METRIC_UNRELIABLE_COPY}</p>
                    <p>Auto: {formatAutoMetricScale(autoMetricScale)}</p>
                  </div>
                )}
                {selectedMetricSpan?.role === "back_floor_wall" ? (
                  <label className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-slate-400">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-cyan-400"
                      checked={trustSelectedBackSpanAsFullWidth}
                      disabled={!applied || selectedMetricSpan.truncation !== "none"}
                      aria-label={AUTO_METRIC_LAB_TRUST_LABEL}
                      onChange={(event) =>
                        setTrustSelectedBackSpanAsFullWidth(event.target.checked)}
                    />
                    <span>{AUTO_METRIC_LAB_TRUST_LABEL}</span>
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={downloadAutoMetricScaleEvidence}
                  className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:border-slate-500"
                >
                  Download Auto Metric Scale
                </button>
              </div>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <h3 className="text-xs font-semibold text-slate-300">
                  Metric Correspondence
                </h3>
                {pipeline?.metricCorrespondence?.selected ? (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>
                      Selected span:{" "}
                      {metricCorrespondenceRoleCopy(
                        pipeline.metricCorrespondence.selected.role,
                      )}
                    </p>
                    <p>
                      Canonical length:{" "}
                      {formatCanonicalGaugeUnits(
                        pipeline.metricCorrespondence.selected.canonicalLength,
                      )}
                    </p>
                    <p>
                      Image span:{" "}
                      {pipeline.metricCorrespondence.selected.imageLengthNormalized
                        .toFixed(2)}{" "}
                      normalized
                    </p>
                    <p>
                      Overlay:{" "}
                      {pipeline.metricCorrespondence.selected.overlaySafeOnOriginal
                        ? "ORIGINAL-safe"
                        : "unsafe"}
                    </p>
                    {pipeline.metricCorrespondence.selected.lineage.sourceSeamId ? (
                      <p>
                        Source seam:{" "}
                        {pipeline.metricCorrespondence.selected.lineage.sourceSeamId}
                      </p>
                    ) : null}
                    <p>
                      Confidence:{" "}
                      {pipeline.metricCorrespondence.selected.confidence.toFixed(2)}
                    </p>
                    <p>
                      Rejected:{" "}
                      {pipeline.metricCorrespondence.rejectedAlternatives.length}
                    </p>
                    <p className="pt-3 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                      Diagnostic span estimate
                    </p>
                    {metricCorrespondenceEstimateIsAccepted(
                      pipeline.metricCorrespondenceEstimate,
                    ) &&
                    pipeline.metricCorrespondenceEstimate?.estimate
                      ?.estimatedLengthM ? (
                      <>
                        <p>
                          Physical span estimate: ~
                          {formatMetricMetres(
                            pipeline.metricCorrespondenceEstimate.estimate
                              .estimatedLengthM.best,
                          )}
                        </p>
                        <p>
                          Range:{" "}
                          {pipeline.metricCorrespondenceEstimate.estimate
                            .estimatedLengthM.low.toFixed(1)}
                          –
                          {pipeline.metricCorrespondenceEstimate.estimate
                            .estimatedLengthM.high.toFixed(1)}{" "}
                          m
                        </p>
                        <p>
                          Confidence:{" "}
                          {pipeline.metricCorrespondenceEstimate.estimate
                            .modelConfidence.toFixed(2)}
                        </p>
                        {pipeline.metricCorrespondenceEstimate.hostAcceptance
                          .candidateMetricScale !== null ? (
                          <p>
                            Diagnostic candidate scale:{" "}
                            {formatCandidateMetricScale(
                              pipeline.metricCorrespondenceEstimate.hostAcceptance
                                .candidateMetricScale,
                            )}
                          </p>
                        ) : null}
                      </>
                    ) : pipeline.metricCorrespondenceEstimate ? (
                      <p>
                        {METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY}
                      </p>
                    ) : (
                      <p>{METRIC_SPAN_ESTIMATE_NOT_RUN_COPY}</p>
                    )}
                    <p className="text-slate-600">
                      Status: {METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY}
                    </p>
                    <p className="text-slate-600">
                      {METRIC_SPAN_ESTIMATE_NOT_APPLIED_COPY}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                    <p>No eligible finite span</p>
                    <p className="text-slate-600">
                      Status: {METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY}
                    </p>
                  </div>
                )}
                {pipeline?.metricCorrespondence ? (
                  <button
                    type="button"
                    onClick={downloadMetricCorrespondenceEvidence}
                    className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:border-slate-500"
                  >
                    Download Metric Correspondence
                  </button>
                ) : null}
                {pipeline?.metricCorrespondenceEstimate ? (
                  <button
                    type="button"
                    onClick={downloadMetricCorrespondenceEstimateEvidence}
                    className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:border-slate-500"
                  >
                    Download Span Estimate
                  </button>
                ) : null}
              </div>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">
                Room Observations
              </h2>
              {pipeline?.roomObservation ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                  <p className="font-medium text-slate-300">
                    Basis: EMPTY · Authority: observation only
                  </p>
                  <p>
                    Status: {pipeline.roomObservation.observerStatus}
                  </p>
                  <p>
                    {pipeline.roomObservation.observedPlanes.length} visible
                    planes ·{" "}
                    {pipeline.roomObservation.observedVisibleFloorRegions.length}{" "}
                    visible floor regions
                  </p>
                  <p>
                    {pipeline.roomObservation.observedSeams.length} seams ·{" "}
                    {pipeline.roomObservation.observedOpenings.length} openings ·{" "}
                    {pipeline.roomObservation.observedJunctions.length} junctions
                  </p>
                  {pipeline.roomObservation.observerStatus !== "failed" &&
                      pipeline.roomObservation.qualityGate.focusedSideCeilingWall
                        .observerStatus !== "not_run" ? (
                    <p>
                      Focused side ceiling-wall:{" "}
                      {
                        pipeline.roomObservation.qualityGate.focusedSideCeilingWall
                          .addedSeamIds.length
                      }{" "}
                      added
                      {pipeline.roomObservation.qualityGate.focusedSideCeilingWall
                        .skippedDuplicateSeamIds.length > 0
                        ? ` · ${pipeline.roomObservation.qualityGate.focusedSideCeilingWall.skippedDuplicateSeamIds.length} focused duplicate skipped`
                        : ""}
                      {pipeline.roomObservation.qualityGate.focusedSideCeilingWall
                        .suppressedGeneralSeamIds.length > 0
                        ? ` · ${pipeline.roomObservation.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds.length} general duplicate suppressed`
                        : ""}
                    </p>
                  ) : null}
                  {pipeline.roomObservation.observerStatus !== "failed" &&
                      pipeline.roomObservation.qualityGate.focusedSideFloorWall
                        .observerStatus !== "not_run" ? (
                    <p>
                      Focused side floor-wall:{" "}
                      {
                        pipeline.roomObservation.qualityGate.focusedSideFloorWall
                          .addedSeamIds.length
                      }{" "}
                      seams added
                      {pipeline.roomObservation.qualityGate.focusedSideFloorWall
                        .addedPlaneIds.length > 0
                        ? ` · ${pipeline.roomObservation.qualityGate.focusedSideFloorWall.addedPlaneIds.length} planes added`
                        : ""}
                      {pipeline.roomObservation.qualityGate.focusedSideFloorWall
                        .skippedDuplicateSeamIds.length > 0
                        ? ` · ${pipeline.roomObservation.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.length} focused duplicate skipped`
                        : ""}
                    </p>
                  ) : null}
                  <p className="text-slate-600">
                    {pipeline.roomObservation.schemaVersion}
                  </p>
                  {pipeline.roomObservation.qualityGate
                      .openingClosureAdjustments.length > 0 ? (
                    <p className="text-amber-300/70">
                      {
                        pipeline.roomObservation.qualityGate
                          .openingClosureAdjustments.length
                      }{" "}
                      opening closure claim(s) preserved as partial
                    </p>
                  ) : null}
                  {pipeline.roomObservation.failure ? (
                    <p className="text-amber-300/70">
                      {pipeline.roomObservation.failure.safeDetail}
                    </p>
                  ) : pipeline.roomObservation.qualityGate.unresolved[0] ? (
                    <p className="text-amber-300/70">
                      Unresolved:{" "}
                      {pipeline.roomObservation.qualityGate.unresolved[0]}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  No retained EMPTY observation basis was available.
                </p>
              )}
            </section>
            {pipeline?.roomObservation ? (
              <button
                type="button"
                onClick={downloadRoomObservationEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-orange-200 transition hover:border-slate-500"
              >
                Download V2-S3D EMPTY Room Observation evidence
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <button
                type="button"
                aria-expanded={selectedModelExpanded}
                aria-controls="v2-selected-model-details"
                onClick={() =>
                  setSelectedModelExpanded((open) => !open)
                }
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-800/60"
              >
                <h2 className="min-w-0 truncate text-sm font-semibold text-slate-200">
                  {formatSelectedModelHeading(
                    selectedSceneObject?.label ?? null,
                  )}
                </h2>
                <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">
                  {selectedModelExpanded ? "▾" : "▸"}
                </span>
              </button>
              {selectedModelExpanded ? (
                <div
                  id="v2-selected-model-details"
                  className="mt-3"
                >
                  {selectedSceneObject ? (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-300">
                        {selectedSceneObject.kind === "test_cube"
                          ? "Test Cube"
                          : "GLB"}
                        {" · "}
                        {selectedSceneObject.label}
                      </p>
                      {selectedSceneObject.loadError ? (
                        <p className="text-[11px] text-amber-300/80">
                          {selectedSceneObject.loadError}
                        </p>
                      ) : null}
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Move
                        </p>
                        <div className="space-y-2">
                          <TransformControlRow
                            label="X"
                            value={displayedXzFromCanonical(
                              selectedSceneObject.transform.position.x,
                              metricScale,
                            )}
                            min={movementControlRange.positionX.min}
                            max={movementControlRange.positionX.max}
                            step={movementControlRange.positionX.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) => {
                                const selected = getSelectedSceneObject(current);
                                if (!selected) return current;
                                const next = updateSelectedPositionAxis(
                                  current,
                                  "x",
                                  canonicalXzFromDisplayed(value, metricScale),
                                );
                                const proposed = getSelectedSceneObject(next);
                                if (!proposed) return next;
                                return applyCollisionAwareTransform(
                                  current,
                                  selected.id,
                                  proposed.transform,
                                  "move",
                                );
                              })}
                          />
                          <TransformControlRow
                            label="Y"
                            value={selectedSceneObject.transform.position.y}
                            min={SCENE_TRANSFORM_LIMITS.positionY.min}
                            max={SCENE_TRANSFORM_LIMITS.positionY.max}
                            step={SCENE_TRANSFORM_LIMITS.positionY.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedPositionAxis(current, "y", value)
                              )}
                          />
                          <TransformControlRow
                            label="Z"
                            value={displayedXzFromCanonical(
                              selectedSceneObject.transform.position.z,
                              metricScale,
                            )}
                            min={movementControlRange.positionZ.min}
                            max={movementControlRange.positionZ.max}
                            step={movementControlRange.positionZ.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) => {
                                const selected = getSelectedSceneObject(current);
                                if (!selected) return current;
                                const next = updateSelectedPositionAxis(
                                  current,
                                  "z",
                                  canonicalXzFromDisplayed(value, metricScale),
                                );
                                const proposed = getSelectedSceneObject(next);
                                if (!proposed) return next;
                                return applyCollisionAwareTransform(
                                  current,
                                  selected.id,
                                  proposed.transform,
                                  "move",
                                );
                              })}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Rotate
                        </p>
                        <div className="space-y-2">
                          <TransformControlRow
                            label="X"
                            value={selectedSceneObject.transform.rotationDeg.x}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) => {
                                const selected = getSelectedSceneObject(current);
                                if (!selected) return current;
                                const next = updateSelectedRotationAxis(
                                  current,
                                  "x",
                                  value,
                                );
                                const proposed = getSelectedSceneObject(next);
                                if (!proposed) return next;
                                return applyCollisionAwareTransform(
                                  current,
                                  selected.id,
                                  proposed.transform,
                                  "pose",
                                );
                              })}
                          />
                          <TransformControlRow
                            label="Y"
                            value={selectedSceneObject.transform.rotationDeg.y}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) => {
                                const selected = getSelectedSceneObject(current);
                                if (!selected) return current;
                                const next = updateSelectedRotationAxis(
                                  current,
                                  "y",
                                  value,
                                );
                                const proposed = getSelectedSceneObject(next);
                                if (!proposed) return next;
                                return applyCollisionAwareTransform(
                                  current,
                                  selected.id,
                                  proposed.transform,
                                  "pose",
                                );
                              })}
                          />
                          <TransformControlRow
                            label="Z"
                            value={selectedSceneObject.transform.rotationDeg.z}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) => {
                                const selected = getSelectedSceneObject(current);
                                if (!selected) return current;
                                const next = updateSelectedRotationAxis(
                                  current,
                                  "z",
                                  value,
                                );
                                const proposed = getSelectedSceneObject(next);
                                if (!proposed) return next;
                                return applyCollisionAwareTransform(
                                  current,
                                  selected.id,
                                  proposed.transform,
                                  "pose",
                                );
                              })}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Scale
                        </p>
                        <TransformControlRow
                          label="Uniform"
                          value={selectedSceneObject.transform.uniformScale}
                          min={SCENE_TRANSFORM_LIMITS.uniformScale.min}
                          max={SCENE_TRANSFORM_LIMITS.uniformScale.max}
                          step={SCENE_TRANSFORM_LIMITS.uniformScale.step}
                          disabled={!sceneControlsEnabled}
                          onValue={(value) =>
                            setSceneLayer((current) => {
                              const selected = getSelectedSceneObject(current);
                              if (!selected) return current;
                              const next = updateSelectedUniformScale(current, value);
                              const proposed = getSelectedSceneObject(next);
                              if (!proposed) return next;
                              return applyCollisionAwareTransform(
                                current,
                                selected.id,
                                proposed.transform,
                                "pose",
                              );
                            })}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-slate-500">
                      No selected model. Add a Test Cube or load a GLB after Apply.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Room Boundaries</h2>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showWallBoundary}
                  disabled={!applied}
                  onChange={(event) =>
                    setShowWallBoundary(event.target.checked)}
                  className="accent-amber-400"
                  aria-label="Show Wall Boundary"
                />
                Show Wall Boundary
              </label>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Amber S4A wall-base diagnostic lines only. Authority is
                unchanged.
              </p>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showCollisionBoundary}
                  disabled={!applied}
                  onChange={(event) =>
                    setShowCollisionBoundary(event.target.checked)}
                  className="accent-rose-400"
                  aria-label="Show Collision Boundary"
                />
                Show Collision Boundary
              </label>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Diagnostic line visibility only. Collision enforcement is
                unchanged.
              </p>
              {applied?.roomBoundaries ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
                  <p>{applied.roomBoundaries.schemaVersion}</p>
                  <p>
                    Candidates {applied.roomBoundaries.summary.candidateCount}
                    {" · "}accepted {applied.roomBoundaries.summary.accepted}
                    {" · "}ambiguous {applied.roomBoundaries.summary.ambiguous}
                    {" · "}insufficient {applied.roomBoundaries.summary.insufficient}
                    {" · "}rejected {applied.roomBoundaries.summary.rejected}
                  </p>
                  <p>
                    skipped non-floor-wall{" "}
                    {applied.roomBoundaries.summary.skippedNonFloorWall}
                  </p>
                  <p className="text-cyan-200/80">
                    collisionAuthority = {String(applied.roomBoundaries.collisionAuthority)}
                  </p>
                  <p>
                    EMPTY↔Original:{" "}
                    {applied.roomBoundaries.lineage.emptyToOriginalCompatibility.tier}
                  </p>
                  <p>
                    Interior accepted{" "}
                    {
                      applied.roomBoundaries.candidates.filter((candidate) =>
                        candidate.interior.status === "accepted"
                      ).length
                    }
                  </p>
                  {applied.roomBoundaries.candidates
                    .flatMap((candidate) =>
                      candidate.reasons.map((reason) =>
                        `${candidate.sourceSeamId}: ${reason}`
                      )
                    )
                    .slice(0, 6)
                    .map((reason) => (
                      <p key={reason} className="text-amber-300/70">
                        {reason}
                      </p>
                    ))}
                  {applied.roomBoundaries.constructionReasons[0] ? (
                    <p className="text-slate-500">
                      {applied.roomBoundaries.constructionReasons[0]}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Room-Boundary construction waits for frozen Floor/Camera.
                </p>
              )}
              {applied?.roomCollision ? (
                <div className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                  <p className="font-semibold text-rose-200/90">
                    Collision Authority
                  </p>
                  <p>{applied.roomCollision.schemaVersion}</p>
                  <p className="text-rose-200/80">
                    collisionAuthority = {String(applied.roomCollision.collisionAuthority)}
                  </p>
                  <p>
                    Candidates {applied.roomCollision.summary.candidateCount}
                    {" · "}accepted {applied.roomCollision.summary.accepted}
                    {" · "}ambiguous {applied.roomCollision.summary.ambiguous}
                    {" · "}insufficient {applied.roomCollision.summary.insufficient}
                    {" · "}rejected {applied.roomCollision.summary.rejected}
                  </p>
                  <p>
                    skipped non-S4A-accepted{" "}
                    {applied.roomCollision.summary.skippedNonS4AAccepted}
                  </p>
                  <p>
                    EMPTY↔Original:{" "}
                    {applied.roomCollision.lineage.roomBoundary.compatibilityTier ??
                      "unavailable"}
                  </p>
                  <p>
                    Floor-standing objects cannot cross S4B collision-enabled
                    finite wall-base spans.
                  </p>
                  <p>
                    openingsNotSubtracted = true · verticalExtentUnknown = true ·
                    hiddenContinuation = false · geometryManufactured = false
                  </p>
                  {applied.roomCollision.boundaries.map((boundary) => (
                    <p key={boundary.sourceBoundaryId} className="text-rose-200/70">
                      {boundary.sourceSeamId}: {boundary.status}
                      {" · "}
                      {roomCollisionQualificationBasisLabel(boundary)}
                      {boundary.collisionEnabled ? " · collision-enabled" : ""}
                      {boundary.qualificationReasons[0]
                        ? ` · ${boundary.qualificationReasons.join(", ")}`
                        : ""}
                      {" · "}
                      {boundary.reliabilityClass}
                    </p>
                  ))}
                  {applied.roomCollision.constructionReasons[0] ? (
                    <p className="text-slate-500">
                      {applied.roomCollision.constructionReasons[0]}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
            {applied?.roomBoundaries ? (
              <button
                type="button"
                onClick={downloadRoomBoundaryEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-amber-200 transition hover:border-slate-500"
              >
                Download V2-S4A Room-Boundary authority
              </button>
            ) : null}
            {applied?.roomCollision ? (
              <button
                type="button"
                onClick={downloadRoomCollisionEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-rose-200 transition hover:border-slate-500"
              >
                Download V2-S4B Room-Collision authority
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Room Envelope</h2>
              {applied?.emptyOriginalRegistration ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
                  <p className="font-semibold text-teal-200/90">Registration</p>
                  <p className="text-amber-200/80">
                    diagnostic only
                  </p>
                  <p>
                    Registration path: {registrationPath}
                  </p>
                  <p>{applied.emptyOriginalRegistration.schemaVersion}</p>
                  <p>
                    methodVersion ={" "}
                    {applied.emptyOriginalRegistration.methodVersion}
                  </p>
                  <p>
                    old compatibility:{" "}
                    {applied.emptyOriginalRegistration.oldCompatibilityTier}
                  </p>
                  <p className="text-teal-200/80">
                    registrationClass ={" "}
                    {applied.emptyOriginalRegistration.registrationClass}
                  </p>
                  <p>
                    transformKind = {applied.emptyOriginalRegistration.transformKind}
                  </p>
                  <p>
                    collisionPromotionEligible ={" "}
                    {String(
                      applied.emptyOriginalRegistration.collisionPromotionEligible,
                    )}
                  </p>
                  <p className="text-slate-500">
                    RAW samples{" "}
                    {applied.emptyOriginalRegistration.correspondenceCount}
                    {" / attempted "}
                    {applied.emptyOriginalRegistration.attemptedCorrespondenceCount}
                  </p>
                  <p>
                    anchors{" "}
                    {applied.emptyOriginalRegistration.anchorInlierCount}
                    {" / "}
                    {applied.emptyOriginalRegistration.anchorCount}
                    {" · ridges "}
                    {applied.emptyOriginalRegistration.ridgeInlierCount}
                    {" / "}
                    {applied.emptyOriginalRegistration.ridgeStructureCount}
                  </p>
                  <p>
                    evidence units{" "}
                    {applied.emptyOriginalRegistration.independentEvidenceUnitCount}
                    {" / attempted "}
                    {applied.emptyOriginalRegistration.attemptedEvidenceUnitCount}
                    {" · structure inlier fraction "}
                    {applied.emptyOriginalRegistration.inlierFraction === null
                      ? "n/a"
                      : applied.emptyOriginalRegistration.inlierFraction.toFixed(3)}
                  </p>
                  <p>
                    orientation bins{" "}
                    {applied.emptyOriginalRegistration.orientationBinCount ?? "n/a"}
                    {" · zoom lock "}
                    {applied.emptyOriginalRegistration.zoomLockSatisfied === null
                      ? "n/a"
                      : String(applied.emptyOriginalRegistration.zoomLockSatisfied)}
                    {" ("}
                    {applied.emptyOriginalRegistration.zoomLockConfiguration}
                    {")"}
                  </p>
                  <p>
                    contradictions{" "}
                    {applied.emptyOriginalRegistration.contradictionCount}
                  </p>
                  <p>
                    anchor max{" "}
                    {applied.emptyOriginalRegistration.residuals.anchorMax ?? "n/a"}
                    {" · RMS "}
                    {applied.emptyOriginalRegistration.residuals.anchorRms ?? "n/a"}
                  </p>
                  <p>
                    ridge normal max{" "}
                    {applied.emptyOriginalRegistration.residuals.ridgeNormalMax ?? "n/a"}
                    {" · RMS "}
                    {applied.emptyOriginalRegistration.residuals.ridgeNormalRms ?? "n/a"}
                  </p>
                  <p>
                    diagnostic scale{" "}
                    {applied.emptyOriginalRegistration.residuals.diagnosticSimilarity
                      ?.scale ?? "n/a"}
                    {" · tx "}
                    {applied.emptyOriginalRegistration.residuals.diagnosticSimilarity
                      ?.tx ?? "n/a"}
                    {" · ty "}
                    {applied.emptyOriginalRegistration.residuals.diagnosticSimilarity
                      ?.ty ?? "n/a"}
                  </p>
                  <p>
                    ridge scale{" "}
                    {applied.emptyOriginalRegistration.residuals.diagnosticRidgeScale ??
                      "n/a"}
                  </p>
                  <p>
                    spread quadrants{" "}
                    {applied.emptyOriginalRegistration.correspondenceSpread
                      ?.quadrantCount ?? "n/a"}
                    {" · hull "}
                    {applied.emptyOriginalRegistration.correspondenceSpread
                      ?.hullArea ?? "n/a"}
                    {" · pca2 "}
                    {applied.emptyOriginalRegistration.correspondenceSpread
                      ?.secondPcaRatio ?? "n/a"}
                  </p>
                  {applied.emptyOriginalRegistration.constructionReasons[0] ? (
                    <p className="text-amber-300/70">
                      {applied.emptyOriginalRegistration.constructionReasons.join(
                        ", ",
                      )}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  EMPTY↔ORIGINAL registration waits for frozen Floor/Camera.
                </p>
              )}
              {applied?.originalStructuralLocalization ? (
                <div className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                  <p className="font-semibold text-violet-200/90">ORIGINAL Localization</p>
                  <p className="text-amber-200/80">
                    diagnostic only
                  </p>
                  <p>{applied.originalStructuralLocalization.schemaVersion}</p>
                  <p>
                    method = {applied.originalStructuralLocalization.methodVersion}
                  </p>
                  <p className="text-violet-200/80">
                    status = {applied.originalStructuralLocalization.registrationClass}
                  </p>
                  <p>
                    transformKind = {applied.originalStructuralLocalization.transformKind}
                    {" · noGlobalTransformApplied = "}
                    {String(applied.originalStructuralLocalization.noGlobalTransformApplied)}
                  </p>
                  <p>
                    localized walls{" "}
                    {applied.originalStructuralLocalization.summary.localizedFloorWalls}
                    {" · localized openings "}
                    {applied.originalStructuralLocalization.summary.localizedFloorReachingOpenings}
                  </p>
                  <p>
                    no-match {applied.originalStructuralLocalization.summary.noMatch}
                    {" · ambiguous "}
                    {applied.originalStructuralLocalization.summary.ambiguous}
                    {" · rejected "}
                    {applied.originalStructuralLocalization.summary.rejected}
                  </p>
                  <p>
                    collisionPromotionEligible ={" "}
                    {String(
                      applied.originalStructuralLocalization.collisionPromotionEligible,
                    )}
                  </p>
                  <p>
                    World Boundary accepted walls{" "}
                    {applied.originalLocalizedBoundary?.summary.accepted ?? 0}
                  </p>
                </div>
              ) : null}
              {applied?.roomEnvelope ? (
                <div className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                  <p className="font-semibold text-teal-200/90">Envelope</p>
                  <p>{applied.roomEnvelope.schemaVersion}</p>
                  <p>
                    walls enriched{" "}
                    {applied.roomEnvelope.walls.filter((wall) =>
                      wall.residualSolidSpans.length > 0
                    ).length}
                    {" · openings qualified "}
                    {applied.roomEnvelope.openings.filter((opening) =>
                      opening.status === "qualified_floor_gap"
                    ).length}
                  </p>
                  <p>
                    residual wall spans {applied.roomEnvelope.solidBaseSpans.length}
                    {" · opening gaps "}
                    {applied.roomEnvelope.walls.reduce(
                      (sum, wall) => sum + wall.openingGapIntervals.length,
                      0,
                    )}
                  </p>
                  <p>corners: not_evaluated</p>
                  <p>vertical: not_evaluated</p>
                  <p>ceiling: {applied.roomEnvelope.ceiling.status}</p>
                </div>
              ) : null}
              {applied ? (
                <div className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                  <p className="font-semibold text-orange-200/90">Collision</p>
                  <p className="text-orange-200/80">
                    Collision policy: EMPTY-authoritative experiment
                  </p>
                  <p>
                    Image compatibility:{" "}
                    {applied.emptyAuthoritativeCollision?.lineage.compatibilityTier ??
                      applied.roomCollision?.lineage.roomBoundary.compatibilityTier ??
                      applied.emptyOriginalRegistration?.oldCompatibilityTier ??
                      "unavailable"}
                  </p>
                  <p>
                    Identity registration:{" "}
                    {applied.emptyOriginalRegistration?.registrationClass ?? "unavailable"}
                    {" · diagnostic only"}
                  </p>
                  <p>
                    ORIGINAL localization:{" "}
                    {applied.originalStructuralLocalization?.registrationClass ??
                      "not_attempted"}
                    {" · diagnostic only"}
                  </p>
                  <p>
                    EMPTY collision walls:{" "}
                    {applied.emptyAuthoritativeCollision
                      ? `${applied.emptyAuthoritativeCollision.summary.accepted} accepted / ${applied.emptyAuthoritativeCollision.summary.refused} refused`
                      : "unavailable"}
                  </p>
                  <p>
                    baseline S4B collisionAuthority ={" "}
                    {String(applied.roomCollision?.collisionAuthority ?? false)}
                  </p>
                  <p>
                    S4C-CQ collisionAuthority ={" "}
                    {String(
                      applied.roomEnvelopeCollision?.collisionAuthority ?? false,
                    )}
                  </p>
                  <p>
                    OL collisionAuthority ={" "}
                    {String(
                      applied.originalLocalizedCollision?.collisionAuthority ?? false,
                    )}
                  </p>
                  <p className="text-orange-200/80">
                    Active collision source:{" "}
                    {activeCollision.source === "empty_authoritative"
                      ? "EMPTY-authoritative"
                      : activeCollision.source === "ol_cq"
                      ? "ORIGINAL-localized"
                      : activeCollision.source === "s4c_cq"
                      ? "S4C-CQ"
                      : "S4B"}
                  </p>
                  {applied.emptyAuthoritativeCollision?.walls.map((wall) => (
                    <p key={wall.id} className="text-orange-200/70">
                      {wall.sourceS4ABoundaryId} / {wall.sourceSeamId}: S4A {wall.sourceS4AStatus}
                      {" · "}
                      {wall.compatibilityTier ?? "unavailable"}
                      {" · "}
                      {wall.twoPointObserved
                        ? wall.twoPointCorroborated
                          ? "two-point region-corroborated"
                          : "two-point region corroboration failed"
                        : wall.corroboration.kind === "multi_probe_region_frontier"
                        ? wall.twoPointCorroborated
                          ? "residual-underdetermined region-corroborated"
                          : "residual-underdetermined region corroboration failed"
                        : "multi-point residual-supported"}
                      {" · opening "}
                      {wall.openingCrossing ? "crossing" : "clear"}
                      {wall.collisionEnabled ? " · collision-enabled" : " · refused"}
                      {wall.qualificationReasons[0]
                        ? ` · ${wall.qualificationReasons.join(", ")}`
                        : ""}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
            {applied?.emptyOriginalRegistration ? (
              <button
                type="button"
                onClick={downloadRegistrationEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-teal-200 transition hover:border-slate-500"
              >
                Download V2-S4C0 Registration authority
              </button>
            ) : null}
            {applied?.roomEnvelope ? (
              <button
                type="button"
                onClick={downloadRoomEnvelopeEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-teal-200 transition hover:border-slate-500"
              >
                Download V2-S4C Room-Envelope authority
              </button>
            ) : null}
            {applied?.roomEnvelopeCollision ? (
              <button
                type="button"
                onClick={downloadRoomEnvelopeCollisionEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-teal-200 transition hover:border-slate-500"
              >
                Download V2-S4C Enriched Collision authority
              </button>
            ) : null}
            {applied?.originalStructuralLocalization ? (
              <button
                type="button"
                onClick={downloadOriginalLocalizationEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-violet-200 transition hover:border-slate-500"
              >
                Download V2-S4C0-OL ORIGINAL Structural Localization
              </button>
            ) : null}
            {applied?.originalLocalizedBoundary ? (
              <button
                type="button"
                onClick={downloadOriginalLocalizedBoundaryEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-violet-200 transition hover:border-slate-500"
              >
                Download V2-S4C0-OL ORIGINAL Localized Boundary
              </button>
            ) : null}
            {applied?.originalLocalizedCollision ? (
              <button
                type="button"
                onClick={downloadOriginalLocalizedCollisionEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-violet-200 transition hover:border-slate-500"
              >
                Download V2-S4C OL Collision authority
              </button>
            ) : null}
            {applied?.emptyAuthoritativeCollision ? (
              <button
                type="button"
                onClick={downloadEmptyAuthoritativeCollisionEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-orange-200 transition hover:border-slate-500"
              >
                Download EMPTY-Authoritative Collision Authority
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Supports</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Not implemented.
              </p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
