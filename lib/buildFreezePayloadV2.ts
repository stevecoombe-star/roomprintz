// lib/buildFreezePayloadV2.ts
// ==============================
// Build FreezePayloadV2 from current editor/store state (adapter-driven).
// No side effects. Deterministic snapping applied.
// ==============================

import type {
    FreezePayloadV2,
    CalibrationV2,
    StagingSpecV2,
    NodePayloadV2,
    NodeCategory,
    IntentRole,
    LockLevel,
    StyleBand,
    LightingBand,
    CameraBand,
    RoomType,
  } from "./freezePayloadV2Types";
  import { DETERMINISM, snapPx, snapRotationDeg, snapToStep } from "./determinism";
  import { buildFreezePayloadV2SceneHash, stableNodeSort } from "./freezePayloadV2SceneHash";
  
  /**
   * ===== Adapter types =====
   * These are the *minimum fields* we need from your store nodes.
   * You will adapt/massage your actual node shape into this input.
   */
  export interface EditorNodeForV2 {
    nodeId: string;
  
    skuId: string;
    vendor?: string;
    productKey?: string;
    imageKey?: string;
    variant?: Record<string, string | undefined>;
  
    // Category/role
    category: NodeCategory;
    role: IntentRole;
  
    // Locking & swap constraints
    lockLevel?: LockLevel;
    swapGroup?: string;
  
    // Current transform in image space (most stores have top-left + w/h; we accept that)
    xPx: number;
    yPx: number;
    widthPx: number;
    heightPx: number;
    rotationDeg: number;
    zIndex: number;
  
    // Real-world footprint inches
    footprintIn: {
      widthIn?: number;
      depthIn?: number;
      diameterIn?: number;
      lengthIn?: number;
      heightIn?: number;
    };
  }
  
  export interface BuildFreezePayloadV2Input {
    baseImage: FreezePayloadV2["baseImage"];
    calibration: CalibrationV2;
  
    // Minimal staging bands (keep small)
    stagingBands: {
      roomType: RoomType;
      styleBand: StyleBand;
      lightingBand: LightingBand;
      cameraBand: CameraBand;
      decorAllowance?: StagingSpecV2["decorAllowance"];
      customStyleHint?: string;
    };
  
    nodes: EditorNodeForV2[];
  
    // Default "soft lock" categories (so layout doesn't drift for primaries)
    defaultSoftLockCategories?: NodeCategory[];
  
    // Optional event audit trail (can be empty at first)
    events?: FreezePayloadV2["events"];
  }
  
  export async function buildFreezePayloadV2(
    input: BuildFreezePayloadV2Input
  ): Promise<FreezePayloadV2> {
    const defaultSoftLock = new Set<NodeCategory>(
      input.defaultSoftLockCategories ?? ["sofa", "rug", "bed"]
    );
  
    const v2Nodes: NodePayloadV2[] = input.nodes.map((n) => {
      // Convert top-left to center anchoring:
      const cx = n.xPx + n.widthPx / 2;
      const cy = n.yPx + n.heightPx / 2;
  
      // Snap inches for determinism:
      const fp = {
        widthIn:
          n.footprintIn.widthIn != null
            ? snapToStep(n.footprintIn.widthIn, DETERMINISM.IN_SNAP)
            : undefined,
        depthIn:
          n.footprintIn.depthIn != null
            ? snapToStep(n.footprintIn.depthIn, DETERMINISM.IN_SNAP)
            : undefined,
        diameterIn:
          n.footprintIn.diameterIn != null
            ? snapToStep(n.footprintIn.diameterIn, DETERMINISM.IN_SNAP)
            : undefined,
        lengthIn:
          n.footprintIn.lengthIn != null
            ? snapToStep(n.footprintIn.lengthIn, DETERMINISM.IN_SNAP)
            : undefined,
        heightIn:
          n.footprintIn.heightIn != null
            ? snapToStep(n.footprintIn.heightIn, DETERMINISM.IN_SNAP)
            : undefined,
      };
  
      const resolvedLock: LockLevel =
        n.lockLevel ??
        (defaultSoftLock.has(n.category) ? "SOFT_LOCK" : "UNLOCKED");
  
      return {
        nodeId: n.nodeId,
        sku: {
          skuId: n.skuId,
          vendor: n.vendor,
          productKey: n.productKey,
          imageKey: n.imageKey,
          variant: n.variant,
        },
        footprintIn: fp,
        transform: {
          cxPx: snapPx(cx),
          cyPx: snapPx(cy),
          rotationDeg: snapRotationDeg(n.rotationDeg),
          zIndex: n.zIndex,
        },
        intent: {
          category: n.category,
          role: n.role,
          lockLevel: resolvedLock,
          anchor: "floor",
          swapGroup: n.swapGroup,
        },
      };
    });
  
    const lockedNodeIds = v2Nodes
      .filter((n) => n.intent.lockLevel === "LOCKED")
      .map((n) => n.nodeId)
      .sort();
  
    const softLockedNodeIds = v2Nodes
      .filter((n) => n.intent.lockLevel === "SOFT_LOCK")
      .map((n) => n.nodeId)
      .sort();
  
    const staging: StagingSpecV2 = {
      roomType: input.stagingBands.roomType,
      styleBand: input.stagingBands.styleBand,
      lightingBand: input.stagingBands.lightingBand,
      cameraBand: input.stagingBands.cameraBand,
      decorAllowance: input.stagingBands.decorAllowance,
      customStyleHint: input.stagingBands.customStyleHint,
      layoutLocks: { lockedNodeIds, softLockedNodeIds },
    };
  
    const payloadNoHash: Omit<FreezePayloadV2, "sceneHash" | "seed"> = {
      payloadVersion: "v2",
      baseImage: input.baseImage,
      calibration: input.calibration,
      staging,
      nodes: [...v2Nodes].sort(stableNodeSort),
      events: input.events,
    };
  
    const sceneHash = await buildFreezePayloadV2SceneHash(payloadNoHash);
    const seed = sceneHash.slice(0, 16);
  
    return {
      ...payloadNoHash,
      sceneHash,
      seed,
    };
  }
  