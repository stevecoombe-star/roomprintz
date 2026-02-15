// lib/freezePayloadV2Types.ts
// ==============================
// FreezePayloadV2 — deterministic staging contract (TYPES ONLY)
// ==============================

export type FreezePayloadVersion = "v1" | "v2";

export type RoomType =
  | "living_room"
  | "bedroom"
  | "dining_room"
  | "studio"
  | "office"
  | "other";

export type CameraBand =
  | "wide_eye_level_natural"
  | "standard_eye_level_natural"
  | "slightly_wide_eye_level"
  | "tight_eye_level";

export type LightingBand =
  | "soft_daylight"
  | "neutral_daylight"
  | "warm_evening_practicals"
  | "mixed_soft";

export type StyleBand =
  | "modern_scandi_neutral"
  | "cozy_neutral"
  | "modern_minimal"
  | "warm_modern"
  | "eclectic_soft"
  | "custom";

export type NodeCategory =
  | "sofa"
  | "chair"
  | "table_coffee"
  | "table_side"
  | "table_dining"
  | "bed"
  | "rug"
  | "lamp_floor"
  | "lamp_table"
  | "storage"
  | "tv_stand"
  | "desk"
  | "decor";

export type IntentRole = "primary" | "secondary" | "accent" | "decor";

export type LockLevel = "LOCKED" | "SOFT_LOCK" | "UNLOCKED";

export type Anchor = "floor" | "wall" | "ceiling";

export type SwapMode = "material_only" | "same_shape" | "allow_dimension_shift";

export interface CalibrationV2 {
  pxPerIn: number;

  method?: "user_line" | "auto_fit" | "imported";
  reference?: {
    lineLengthIn?: number;
    lineLengthPx?: number;
  };
}

export interface SkuIdentityV2 {
  skuId: string;
  vendor?: string;
  source?: string;
  variant?: {
    color?: string;
    material?: string;
    finish?: string;
    [k: string]: string | undefined;
  };
  imageKey?: string;
  productKey?: string;
}

export interface FootprintInV2 {
  widthIn?: number;
  depthIn?: number;
  diameterIn?: number;
  lengthIn?: number;
  heightIn?: number;
}

export interface TransformImageSpaceV2 {
  // Center-anchored footprint placement in image space.
  cxPx: number;
  cyPx: number;
  rotationDeg: number;
  zIndex: number;
}

export interface NodeIntentV2 {
  category: NodeCategory;
  role: IntentRole;
  lockLevel: LockLevel;
  anchor: Anchor;

  swapGroup?: string;
  styleTags?: string[];
  negatives?: string[];
}

export interface NodePayloadV2 {
  nodeId: string;
  sku: SkuIdentityV2;

  footprintIn: FootprintInV2;
  transform: TransformImageSpaceV2;

  intent: NodeIntentV2;

  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface StagingSpecV2 {
  roomType: RoomType;
  styleBand: StyleBand;
  lightingBand: LightingBand;
  cameraBand: CameraBand;

  layoutLocks: {
    lockedNodeIds: string[];
    softLockedNodeIds: string[];
  };

  decorAllowance?: "none" | "minimal" | "moderate";
  customStyleHint?: string;
}

export interface SwapEventV2 {
  kind: "swap";
  ts: number;
  targetNodeId: string;
  fromSkuId: string;
  toSkuId: string;
  swapGroup?: string;
  swapMode: SwapMode;
}

export interface RevisionEventV2 {
  kind: "revision";
  ts: number;
  note?: string;
}

export type SceneEventV2 = SwapEventV2 | RevisionEventV2;

/** Remove mark in image-space pixels (v1: deterministic ordering via labelIndex 1..N). */
export interface RemoveMarkV2 {
  id: string;
  x: number;
  y: number;
  r: number;
  labelIndex?: number;
}

export type VibodeIntentV2 =
  | { mode: "place" }
  | { mode: "remove"; marks: RemoveMarkV2[] };

export interface FreezePayloadV2 {
  payloadVersion: "v2";

  baseImage: {
    storageKey?: string;
    signedUrl?: string;
    imageBase64?: string;
    widthPx?: number;
    heightPx?: number;
  };

  calibration: CalibrationV2;

  staging: StagingSpecV2;

  nodes: NodePayloadV2[];

  /** Vibode intent: place (default) or remove with red X marks. */
  vibodeIntent?: VibodeIntentV2;

  sceneHash: string;
  seed?: string;

  events?: SceneEventV2[];
}
