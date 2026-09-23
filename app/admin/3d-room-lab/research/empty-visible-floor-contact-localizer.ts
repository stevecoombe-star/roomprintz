import sharp from "sharp";

import {
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  type CertifiedEmptyVisibleFloorSourceIdentity,
  type EmptyVisibleFloorRegion,
  type EmptyVisibleFloorRegionParameters,
  readCertifiedEmptyVisibleFloorRegion,
} from "./empty-visible-floor-region";

export const VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION =
  "p2-s2d-visible-floor-contact-localizer/v1" as const;
export const VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE =
  "empty-source-normalized/v1" as const;
export const VISIBLE_FLOOR_CONTACT_STRIPE_RETURN_DISTANCE_PX = 5 as const;

export type VisibleFloorContactPoint = Readonly<{ x: number; y: number }>;

export type VisibleFloorTerminationEndpoint = Readonly<{
  state: "uncertain_support_limit";
  pointSourceNormalized: VisibleFloorContactPoint;
}>;

export type VisibleFloorTerminationEvidence = Readonly<{
  sourceRegionVersion: typeof EMPTY_VISIBLE_FLOOR_REGION_VERSION;
  interiorSupportRule:
    "seed_connected_local_appearance_continuity_with_thin_reconciliation";
  outwardDirectionRule: "local_core_contour_normal";
  transitionRule: "first_supported_outward_appearance_transition";
  sourcePixelLength: number;
  contactSampleCount: number;
  meanSearchDistancePx: number;
  maximumNeighborStepPx: number;
  meanInsideRegionSupportFraction: number;
  meanOutsideRegionExclusionFraction: number;
  meanInsideRawMaskSupportFraction: number;
  meanOutsideRawMaskExclusionFraction: number;
  coreOriginStartSourcePx: VisibleFloorContactPoint;
  coreOriginEndSourcePx: VisibleFloorContactPoint;
  meanOutwardNormal: VisibleFloorContactPoint;
  meanTransitionRgbDistance: number;
  minimumTransitionRgbDistance: number;
  minimumFrameDistancePx: number;
}>;

export type VisibleFloorTerminationFragment = Readonly<{
  id: string;
  roomId: string;
  emptyImageSha256: string;
  coordinateSpace: typeof VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE;
  proposalVersion: typeof VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION;
  geometryKind: "finite_open_visible_floor_termination";
  pointsSourceNormalized: readonly VisibleFloorContactPoint[];
  startEndpoint: VisibleFloorTerminationEndpoint;
  endEndpoint: VisibleFloorTerminationEndpoint;
  evidence: VisibleFloorTerminationEvidence;
}>;

export type VisibleFloorContactLocalizerParameters = Readonly<{
  coreErosionRadiusPx: number;
  contourTangentRadiusPx: number;
  frontierSampleStridePx: number;
  normalProbeDistancePx: number;
  minimumSearchDistancePx: number;
  maximumSearchDistancePx: number;
  transitionPatchRadiusPx: number;
  transitionOffsetPx: number;
  supportWindowStartPx: number;
  supportWindowEndPx: number;
  exclusionWindowStartPx: number;
  exclusionWindowEndPx: number;
  minimumInsideRegionSupportFraction: number;
  minimumOutsideRegionExclusionFraction: number;
  minimumTransitionRgbDistance: number;
  minimumTransitionLumaDistance: number;
  maximumUnsupportedWalkPx: number;
  ambiguitySeparationPx: number;
  ambiguityScoreRatio: number;
  maximumContourSampleGap: number;
  maximumCandidateNeighborStepPx: number;
  minimumNeighborNormalDot: number;
  maximumChainTurnDeg: number;
  minimumFragmentSamples: number;
  minimumFragmentLengthPx: number;
  imageFrameMarginPx: number;
  maximumReattachThicknessPx: number;
}>;

/**
 * One global parameter set. A seed-connected local appearance flood removes
 * mask-qualified structural leaks. Each trusted-core contour sample accepts
 * the first locally supported outward appearance transition; later responses
 * are ignored.
 */
export const P2_S2D_VISIBLE_FLOOR_CONTACT_PARAMETERS:
  VisibleFloorContactLocalizerParameters = Object.freeze({
    coreErosionRadiusPx: 10,
    contourTangentRadiusPx: 8,
    frontierSampleStridePx: 2,
    normalProbeDistancePx: 7,
    minimumSearchDistancePx: 3,
    maximumSearchDistancePx: 72,
    transitionPatchRadiusPx: 2,
    transitionOffsetPx: 3,
    supportWindowStartPx: 10,
    supportWindowEndPx: 2,
    exclusionWindowStartPx: 3,
    exclusionWindowEndPx: 12,
    minimumInsideRegionSupportFraction: 0.75,
    minimumOutsideRegionExclusionFraction: 0.65,
    minimumTransitionRgbDistance: 14,
    minimumTransitionLumaDistance: 7,
    maximumUnsupportedWalkPx: 2,
    ambiguitySeparationPx: 7,
    ambiguityScoreRatio: 0.82,
    maximumContourSampleGap: 2,
    maximumCandidateNeighborStepPx: 7,
    minimumNeighborNormalDot: 0.75,
    maximumChainTurnDeg: 42,
    minimumFragmentSamples: 8,
    minimumFragmentLengthPx: 20,
    imageFrameMarginPx: 4,
    maximumReattachThicknessPx: 13,
  });

export type VisibleFloorContactDecodedImage = Readonly<{
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}>;

export type VisibleFloorContactSupportComponentDiagnostic = Readonly<{
  id: string;
  rawExcludedPixelCount: number;
  maximumInteriorDistancePx: number;
  maximumThicknessPx: number;
  boundsSourcePx: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  farPatchSampleCount: number;
  meanFarPatchRgbDistance: number;
  meanFarPatchLumaDistance: number;
  farPatchReturnFraction: number;
  stripeReturnRestoredPixelCount: number;
  thinComponentRestoredPixelCount: number;
  remainingExcludedPixelCount: number;
  stripeReturnRestored: boolean;
  thinComponentRestored: boolean;
  remainedExcluded: boolean;
}>;

export type VisibleFloorContactDiagnostics = Readonly<{
  rawRegionPixelCount: number;
  appearanceContinuousPixelCount: number;
  appearanceContinuityRejectedEdgeCount: number;
  stripeReturnRestoredPixelCount: number;
  thinComponentRestoredPixelCount: number;
  supportComponents:
    readonly VisibleFloorContactSupportComponentDiagnostic[];
  coreSeedSourcePx: PixelPoint;
  corePixelCount: number;
  coreContourPointCount: number;
  sampledFrontierCount: number;
  supportedTransitionCount: number;
  fragmentCount: number;
  rejected: Readonly<{
    noOutwardNormal: number;
    noSupportedTransition: number;
    ambiguousTransition: number;
    frameProximity: number;
    shortChain: number;
  }>;
}>;

export type VisibleFloorContactLocalization = Readonly<{
  region: EmptyVisibleFloorRegion;
  parameters: VisibleFloorContactLocalizerParameters;
  fragments: readonly VisibleFloorTerminationFragment[];
  diagnostics: VisibleFloorContactDiagnostics;
}>;

export type VisibleFloorContactReadResult =
  | Readonly<{ ok: true; localization: VisibleFloorContactLocalization }>
  | Readonly<{
      ok: false;
      reason:
        | "decode_failed"
        | "fixture_identity_mismatch"
        | "lower_center_seed_not_floor_like"
        | "empty_seed_component"
        | "empty_conservative_core";
    }>;

type PixelPoint = Readonly<{ x: number; y: number }>;
type Vector = Readonly<{ x: number; y: number }>;
type DirectedEdge = Readonly<{ start: PixelPoint; end: PixelPoint }>;

type ContactSample = Readonly<{
  contourIndex: number;
  coreOrigin: PixelPoint;
  point: PixelPoint;
  normal: Vector;
  searchDistancePx: number;
  insideRegionSupportFraction: number;
  outsideRegionExclusionFraction: number;
  insideRawMaskSupportFraction: number;
  outsideRawMaskExclusionFraction: number;
  transitionRgbDistance: number;
  transitionLumaDistance: number;
  frameDistancePx: number;
}>;

type CandidateSearch =
  | Readonly<{ state: "accepted"; sample: ContactSample }>
  | Readonly<{
      state:
        | "no_outward_normal"
        | "no_supported_transition"
        | "ambiguous_transition"
        | "frame_proximity";
    }>;

function maskAt(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  return roundedX >= 0 &&
    roundedY >= 0 &&
    roundedX < width &&
    roundedY < height &&
    mask[roundedY * width + roundedX] !== 0;
}

function nearestPresentPixel(
  mask: Uint8Array,
  width: number,
  height: number,
  origin: PixelPoint
): PixelPoint | null {
  if (maskAt(mask, width, height, origin.x, origin.y)) return origin;
  const maximumRadius = Math.max(width, height);
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    const minimumX = Math.max(0, origin.x - radius);
    const maximumX = Math.min(width - 1, origin.x + radius);
    const minimumY = Math.max(0, origin.y - radius);
    const maximumY = Math.min(height - 1, origin.y + radius);
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (mask[minimumY * width + x] !== 0) return { x, y: minimumY };
      if (mask[maximumY * width + x] !== 0) return { x, y: maximumY };
    }
    for (let y = minimumY + 1; y < maximumY; y += 1) {
      if (mask[y * width + minimumX] !== 0) return { x: minimumX, y };
      if (mask[y * width + maximumX] !== 0) return { x: maximumX, y };
    }
  }
  return null;
}

function externalEmptyMask(
  core: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const external = new Uint8Array(core.length);
  const queue = new Int32Array(core.length);
  let read = 0;
  let write = 0;
  const enqueue = (index: number) => {
    if (core[index] !== 0 || external[index] !== 0) return;
    external[index] = 1;
    queue[write] = index;
    write += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (read < write) {
    const index = queue[read];
    read += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }
  return external;
}

function pointKey(point: PixelPoint): string {
  return `${point.x},${point.y}`;
}

function directedOuterEdges(
  core: Uint8Array,
  external: Uint8Array,
  width: number,
  height: number
): readonly DirectedEdge[] {
  const edges: DirectedEdge[] = [];
  const isExternal = (x: number, y: number) =>
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height ||
    external[y * width + x] !== 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (core[y * width + x] === 0) continue;
      if (isExternal(x, y - 1)) {
        edges.push({ start: { x: x + 1, y }, end: { x, y } });
      }
      if (isExternal(x + 1, y)) {
        edges.push({
          start: { x: x + 1, y: y + 1 },
          end: { x: x + 1, y },
        });
      }
      if (isExternal(x, y + 1)) {
        edges.push({
          start: { x, y: y + 1 },
          end: { x: x + 1, y: y + 1 },
        });
      }
      if (isExternal(x - 1, y)) {
        edges.push({ start: { x, y }, end: { x, y: y + 1 } });
      }
    }
  }
  return Object.freeze(edges);
}

function tracedLoops(edges: readonly DirectedEdge[]): readonly PixelPoint[][] {
  const byStart = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.start);
    byStart.set(key, [...(byStart.get(key) ?? []), index]);
  });
  const used = new Uint8Array(edges.length);
  const loops: PixelPoint[][] = [];
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (used[startIndex] !== 0) continue;
    const points: PixelPoint[] = [];
    let edgeIndex = startIndex;
    const startKey = pointKey(edges[startIndex].start);
    while (used[edgeIndex] === 0) {
      const edge = edges[edgeIndex];
      used[edgeIndex] = 1;
      points.push({
        x: (edge.start.x + edge.end.x) / 2,
        y: (edge.start.y + edge.end.y) / 2,
      });
      const next = (byStart.get(pointKey(edge.end)) ?? [])
        .find(index => used[index] === 0);
      if (next === undefined) break;
      edgeIndex = next;
      if (pointKey(edges[edgeIndex].start) === startKey) {
        const closing = edges[edgeIndex];
        used[edgeIndex] = 1;
        points.push({
          x: (closing.start.x + closing.end.x) / 2,
          y: (closing.start.y + closing.end.y) / 2,
        });
        break;
      }
    }
    if (points.length >= 4) loops.push(points);
  }
  return Object.freeze(loops);
}

function normalizedVector(vector: Vector): Vector | null {
  const length = Math.hypot(vector.x, vector.y);
  return length <= 1e-6
    ? null
    : Object.freeze({ x: vector.x / length, y: vector.y / length });
}

function contourNormal(
  contour: readonly PixelPoint[],
  index: number,
  core: Uint8Array,
  width: number,
  height: number,
  parameters: VisibleFloorContactLocalizerParameters
): Vector | null {
  const radius = Math.min(
    parameters.contourTangentRadiusPx,
    Math.floor(contour.length / 4)
  );
  if (radius < 1) return null;
  const before = contour[(index - radius + contour.length) % contour.length];
  const after = contour[(index + radius) % contour.length];
  const tangent = normalizedVector({
    x: after.x - before.x,
    y: after.y - before.y,
  });
  if (!tangent) return null;
  const normals = [
    { x: -tangent.y, y: tangent.x },
    { x: tangent.y, y: -tangent.x },
  ] as const;
  const occupancy = normals.map(normal => {
    let count = 0;
    for (
      let distance = 1;
      distance <= parameters.normalProbeDistancePx;
      distance += 1
    ) {
      if (maskAt(
        core,
        width,
        height,
        contour[index].x + normal.x * distance,
        contour[index].y + normal.y * distance
      )) count += 1;
    }
    return count;
  });
  if (occupancy[0] === occupancy[1]) return null;
  return Object.freeze(occupancy[0] < occupancy[1] ? normals[0] : normals[1]);
}

function pixelRgb(
  image: VisibleFloorContactDecodedImage,
  x: number,
  y: number
): readonly [number, number, number] {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const offset = (clampedY * image.width + clampedX) * image.channels;
  return [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
  ];
}

function patchMeanRgb(
  image: VisibleFloorContactDecodedImage,
  center: PixelPoint,
  radius: number
): readonly [number, number, number] {
  const centerX = Math.round(center.x);
  const centerY = Math.round(center.y);
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const rgb = pixelRgb(image, x, y);
      red += rgb[0];
      green += rgb[1];
      blue += rgb[2];
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

function rgbDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  );
}

function luma(rgb: readonly [number, number, number]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

type AppearanceStepEvidence = Readonly<{
  rgbDistance: number;
  lumaDistance: number;
}>;

function localAppearanceSideMean(
  image: VisibleFloorContactDecodedImage,
  edgePoint: PixelPoint,
  unitDirection: Vector,
  side: -1 | 1,
  parameters: VisibleFloorContactLocalizerParameters
): readonly [number, number, number] {
  const tangent = { x: -unitDirection.y, y: unitDirection.x };
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (
    let depth = 0;
    depth <= parameters.transitionPatchRadiusPx;
    depth += 1
  ) {
    for (
      let offset = -parameters.transitionPatchRadiusPx;
      offset <= parameters.transitionPatchRadiusPx;
      offset += 1
    ) {
      const rgb = pixelRgb(
        image,
        edgePoint.x + unitDirection.x * depth * side + tangent.x * offset,
        edgePoint.y + unitDirection.y * depth * side + tangent.y * offset
      );
      red += rgb[0];
      green += rgb[1];
      blue += rgb[2];
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

function appearanceEvidence(
  source: readonly [number, number, number],
  destination: readonly [number, number, number]
): AppearanceStepEvidence {
  return Object.freeze({
    rgbDistance: rgbDistance(source, destination),
    lumaDistance: Math.abs(luma(source) - luma(destination)),
  });
}

function localAppearanceStepEvidence(
  image: VisibleFloorContactDecodedImage,
  source: PixelPoint,
  destination: PixelPoint,
  parameters: VisibleFloorContactLocalizerParameters
): AppearanceStepEvidence {
  const unitDirection = {
    x: destination.x - source.x,
    y: destination.y - source.y,
  };
  return appearanceEvidence(
    localAppearanceSideMean(image, source, unitDirection, -1, parameters),
    localAppearanceSideMean(image, destination, unitDirection, 1, parameters)
  );
}

function farPatchReturnEvidence(
  image: VisibleFloorContactDecodedImage,
  proposalMask: Uint8Array,
  source: PixelPoint,
  destination: PixelPoint,
  parameters: VisibleFloorContactLocalizerParameters
): AppearanceStepEvidence | null {
  const unitDirection = {
    x: destination.x - source.x,
    y: destination.y - source.y,
  };
  const farPoint = pointAlong(
    source,
    unitDirection,
    VISIBLE_FLOOR_CONTACT_STRIPE_RETURN_DISTANCE_PX
  );
  if (
    !maskAt(proposalMask, image.width, image.height, farPoint.x, farPoint.y)
  ) return null;
  return appearanceEvidence(
    localAppearanceSideMean(image, source, unitDirection, -1, parameters),
    localAppearanceSideMean(image, farPoint, unitDirection, 1, parameters)
  );
}

function appearanceContinuousSeedComponent(
  image: VisibleFloorContactDecodedImage,
  proposalMask: Uint8Array,
  seed: PixelPoint,
  parameters: VisibleFloorContactLocalizerParameters,
  allowStripeReturn: boolean
): Readonly<{
  mask: Uint8Array;
  count: number;
  rejectedEdgeCount: number;
  stripeReturnRestoredPixelCount: number;
}> | null {
  if (!maskAt(proposalMask, image.width, image.height, seed.x, seed.y)) {
    return null;
  }
  const output = new Uint8Array(proposalMask.length);
  const queue = new Int32Array(proposalMask.length);
  const seedIndex = seed.y * image.width + seed.x;
  let read = 0;
  let write = 1;
  let rejectedEdgeCount = 0;
  let stripeReturnRestoredPixelCount = 0;
  output[seedIndex] = 1;
  queue[0] = seedIndex;

  while (read < write) {
    const index = queue[read];
    read += 1;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < image.width - 1 ? index + 1 : -1,
      y > 0 ? index - image.width : -1,
      y < image.height - 1 ? index + image.width : -1,
    ];
    for (const neighbor of neighbors) {
      if (
        neighbor < 0 ||
        proposalMask[neighbor] === 0 ||
        output[neighbor] !== 0
      ) continue;
      const source = { x, y };
      const destination = {
        x: neighbor % image.width,
        y: Math.floor(neighbor / image.width),
      };
      const local = localAppearanceStepEvidence(
        image,
        source,
        destination,
        parameters
      );
      const locallyContinuous =
        local.rgbDistance < parameters.minimumTransitionRgbDistance ||
        local.lumaDistance < parameters.minimumTransitionLumaDistance;
      let stripeReturn = false;
      if (!locallyContinuous && allowStripeReturn) {
        const far = farPatchReturnEvidence(
          image,
          proposalMask,
          source,
          destination,
          parameters
        );
        stripeReturn = far !== null &&
          far.rgbDistance < parameters.minimumTransitionRgbDistance &&
          far.lumaDistance < parameters.minimumTransitionLumaDistance;
      }
      if (!locallyContinuous && !stripeReturn) {
        rejectedEdgeCount += 1;
        continue;
      }
      if (stripeReturn) {
        const unitDirection = {
          x: destination.x - source.x,
          y: destination.y - source.y,
        };
        for (
          let distance = 1;
          distance <= VISIBLE_FLOOR_CONTACT_STRIPE_RETURN_DISTANCE_PX;
          distance += 1
        ) {
          const point = pointAlong(source, unitDirection, distance);
          const pointX = Math.round(point.x);
          const pointY = Math.round(point.y);
          if (
            pointX < 0 ||
            pointY < 0 ||
            pointX >= image.width ||
            pointY >= image.height
          ) break;
          const pointIndex = pointY * image.width + pointX;
          if (proposalMask[pointIndex] === 0) break;
          if (output[pointIndex] !== 0) continue;
          output[pointIndex] = 1;
          queue[write] = pointIndex;
          write += 1;
          stripeReturnRestoredPixelCount += 1;
        }
        continue;
      }
      output[neighbor] = 1;
      queue[write] = neighbor;
      write += 1;
    }
  }
  return Object.freeze({
    mask: output,
    count: write,
    rejectedEdgeCount,
    stripeReturnRestoredPixelCount,
  });
}

type ExcludedSupportComponent = Readonly<{
  indices: readonly number[];
  pixelCount: number;
  maximumInteriorDistancePx: number;
  maximumThicknessPx: number;
  boundsSourcePx: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
}>;

function componentMaximumInteriorDistance(
  indices: readonly number[],
  bounds: ExcludedSupportComponent["boundsSourcePx"],
  sourceWidth: number
): number {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const distances = new Uint16Array(width * height);
  for (const index of indices) {
    const sourceX = index % sourceWidth;
    const sourceY = Math.floor(index / sourceWidth);
    distances[
      (sourceY - bounds.minY) * width + sourceX - bounds.minX
    ] = 0xffff;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distances[index] === 0) continue;
      const left = x > 0 ? distances[index - 1] : 0;
      const above = y > 0 ? distances[index - width] : 0;
      distances[index] = Math.min(
        distances[index],
        left + 1,
        above + 1
      );
    }
  }
  let maximum = 0;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distances[index] === 0) continue;
      const right = x < width - 1 ? distances[index + 1] : 0;
      const below = y < height - 1 ? distances[index + width] : 0;
      distances[index] = Math.min(
        distances[index],
        right + 1,
        below + 1
      );
      maximum = Math.max(maximum, distances[index]);
    }
  }
  return maximum;
}

function excludedSupportComponents(
  rawMask: Uint8Array,
  supportMask: Uint8Array,
  width: number,
  height: number
): Readonly<{
  labels: Int32Array;
  components: readonly ExcludedSupportComponent[];
}> {
  const labels = new Int32Array(rawMask.length);
  labels.fill(-1);
  const queue = new Int32Array(rawMask.length);
  const components: ExcludedSupportComponent[] = [];
  for (let start = 0; start < rawMask.length; start += 1) {
    if (
      rawMask[start] === 0 ||
      supportMask[start] !== 0 ||
      labels[start] !== -1
    ) continue;
    const componentIndex = components.length;
    let read = 0;
    let write = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    const indices: number[] = [];
    queue[0] = start;
    labels[start] = componentIndex;
    while (read < write) {
      const index = queue[read];
      read += 1;
      indices.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          rawMask[neighbor] !== 0 &&
          supportMask[neighbor] === 0 &&
          labels[neighbor] === -1
        ) {
          labels[neighbor] = componentIndex;
          queue[write] = neighbor;
          write += 1;
        }
      }
    }
    const bounds = Object.freeze({ minX, minY, maxX, maxY });
    const maximumInteriorDistancePx = componentMaximumInteriorDistance(
      indices,
      bounds,
      width
    );
    components.push(Object.freeze({
      indices: Object.freeze(indices),
      pixelCount: indices.length,
      maximumInteriorDistancePx,
      maximumThicknessPx: maximumInteriorDistancePx * 2 - 1,
      boundsSourcePx: bounds,
    }));
  }
  return Object.freeze({
    labels,
    components: Object.freeze(components),
  });
}

function componentFarPatchSummary(
  component: ExcludedSupportComponent,
  supportMask: Uint8Array,
  proposalMask: Uint8Array,
  image: VisibleFloorContactDecodedImage,
  parameters: VisibleFloorContactLocalizerParameters
): Readonly<{
  sampleCount: number;
  meanRgbDistance: number;
  meanLumaDistance: number;
  returnFraction: number;
}> {
  let sampleCount = 0;
  let rgbDistanceSum = 0;
  let lumaDistanceSum = 0;
  let returnCount = 0;
  for (const destinationIndex of component.indices) {
    const x = destinationIndex % image.width;
    const y = Math.floor(destinationIndex / image.width);
    const neighbors = [
      x > 0 ? destinationIndex - 1 : -1,
      x < image.width - 1 ? destinationIndex + 1 : -1,
      y > 0 ? destinationIndex - image.width : -1,
      y < image.height - 1 ? destinationIndex + image.width : -1,
    ];
    for (const sourceIndex of neighbors) {
      if (sourceIndex < 0 || supportMask[sourceIndex] === 0) continue;
      const evidence = farPatchReturnEvidence(
        image,
        proposalMask,
        {
          x: sourceIndex % image.width,
          y: Math.floor(sourceIndex / image.width),
        },
        { x, y },
        parameters
      );
      if (!evidence) continue;
      sampleCount += 1;
      rgbDistanceSum += evidence.rgbDistance;
      lumaDistanceSum += evidence.lumaDistance;
      if (
        evidence.rgbDistance < parameters.minimumTransitionRgbDistance &&
        evidence.lumaDistance < parameters.minimumTransitionLumaDistance
      ) returnCount += 1;
    }
  }
  return Object.freeze({
    sampleCount,
    meanRgbDistance: sampleCount === 0 ? 0 : rgbDistanceSum / sampleCount,
    meanLumaDistance: sampleCount === 0 ? 0 : lumaDistanceSum / sampleCount,
    returnFraction: sampleCount === 0 ? 0 : returnCount / sampleCount,
  });
}

function reconciledTrustedSupport(
  image: VisibleFloorContactDecodedImage,
  proposalMask: Uint8Array,
  seed: PixelPoint,
  parameters: VisibleFloorContactLocalizerParameters
): Readonly<{
  mask: Uint8Array;
  count: number;
  baseCount: number;
  rejectedEdgeCount: number;
  stripeReturnRestoredPixelCount: number;
  thinComponentRestoredPixelCount: number;
  components: readonly VisibleFloorContactSupportComponentDiagnostic[];
}> | null {
  const base = appearanceContinuousSeedComponent(
    image,
    proposalMask,
    seed,
    parameters,
    false
  );
  if (!base) return null;
  const stripe = appearanceContinuousSeedComponent(
    image,
    proposalMask,
    seed,
    parameters,
    true
  );
  if (!stripe) return null;
  const baseExcluded = excludedSupportComponents(
    proposalMask,
    base.mask,
    image.width,
    image.height
  );
  const afterStripeExcluded = excludedSupportComponents(
    proposalMask,
    stripe.mask,
    image.width,
    image.height
  );
  const finalMask = stripe.mask.slice();
  const stripeRestoredByBase = new Uint32Array(
    baseExcluded.components.length
  );
  const thinRestoredByBase = new Uint32Array(baseExcluded.components.length);
  for (let index = 0; index < finalMask.length; index += 1) {
    const label = baseExcluded.labels[index];
    if (label >= 0 && finalMask[index] !== 0) {
      stripeRestoredByBase[label] += 1;
    }
  }
  let thinComponentRestoredPixelCount = 0;
  for (const component of afterStripeExcluded.components) {
    const baseLabel = baseExcluded.labels[component.indices[0]];
    const baseComponent = baseLabel >= 0
      ? baseExcluded.components[baseLabel]
      : null;
    if (
      !baseComponent ||
      baseComponent.maximumThicknessPx >
        parameters.maximumReattachThicknessPx
    ) continue;
    for (const index of component.indices) {
      finalMask[index] = 1;
      thinComponentRestoredPixelCount += 1;
      const label = baseExcluded.labels[index];
      if (label >= 0) thinRestoredByBase[label] += 1;
    }
  }
  const components = baseExcluded.components.map((component, index) => {
    const stripeRestoredPixelCount = stripeRestoredByBase[index];
    const thinRestoredPixelCount = thinRestoredByBase[index];
    const remainingExcludedPixelCount = component.pixelCount -
      stripeRestoredPixelCount -
      thinRestoredPixelCount;
    const far = componentFarPatchSummary(
      component,
      base.mask,
      proposalMask,
      image,
      parameters
    );
    return Object.freeze({
      id: `p2-s2d-support-component:${String(index).padStart(4, "0")}`,
      rawExcludedPixelCount: component.pixelCount,
      maximumInteriorDistancePx: component.maximumInteriorDistancePx,
      maximumThicknessPx: component.maximumThicknessPx,
      boundsSourcePx: component.boundsSourcePx,
      farPatchSampleCount: far.sampleCount,
      meanFarPatchRgbDistance: far.meanRgbDistance,
      meanFarPatchLumaDistance: far.meanLumaDistance,
      farPatchReturnFraction: far.returnFraction,
      stripeReturnRestoredPixelCount: stripeRestoredPixelCount,
      thinComponentRestoredPixelCount: thinRestoredPixelCount,
      remainingExcludedPixelCount,
      stripeReturnRestored: stripeRestoredPixelCount > 0,
      thinComponentRestored: thinRestoredPixelCount > 0,
      remainedExcluded: remainingExcludedPixelCount > 0,
    });
  });
  return Object.freeze({
    mask: finalMask,
    count: stripe.count + thinComponentRestoredPixelCount,
    baseCount: base.count,
    rejectedEdgeCount: base.rejectedEdgeCount,
    stripeReturnRestoredPixelCount: stripe.count - base.count,
    thinComponentRestoredPixelCount,
    components: Object.freeze(components),
  });
}

function pointAlong(
  point: PixelPoint,
  direction: Vector,
  distance: number
): PixelPoint {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

function maskLineFraction(
  mask: Uint8Array,
  width: number,
  height: number,
  origin: PixelPoint,
  direction: Vector,
  start: number,
  end: number,
  expectedPresent: boolean
): number {
  let matches = 0;
  let count = 0;
  for (let distance = start; distance <= end; distance += 1) {
    const point = pointAlong(origin, direction, distance);
    const present = maskAt(mask, width, height, point.x, point.y);
    if (present === expectedPresent) matches += 1;
    count += 1;
  }
  return count === 0 ? 0 : matches / count;
}

function frameDistance(
  point: PixelPoint,
  width: number,
  height: number
): number {
  return Math.min(
    point.x,
    point.y,
    width - 1 - point.x,
    height - 1 - point.y
  );
}

function searchCandidate(
  contour: readonly PixelPoint[],
  contourIndex: number,
  image: VisibleFloorContactDecodedImage,
  rawRegionMask: Uint8Array,
  trustedSupportMask: Uint8Array,
  core: Uint8Array,
  parameters: VisibleFloorContactLocalizerParameters
): CandidateSearch {
  const origin = contour[contourIndex];
  const normal = contourNormal(
    contour,
    contourIndex,
    core,
    image.width,
    image.height,
    parameters
  );
  if (!normal) return { state: "no_outward_normal" };
  const inwardProbe = pointAlong(origin, normal, -1);
  if (!maskAt(
    trustedSupportMask,
    image.width,
    image.height,
    inwardProbe.x,
    inwardProbe.y
  )) return { state: "no_supported_transition" };

  const plausible: ContactSample[] = [];
  let unsupportedWalk = 0;
  for (
    let distance = parameters.minimumSearchDistancePx;
    distance <= parameters.maximumSearchDistancePx;
    distance += 1
  ) {
    const center = pointAlong(origin, normal, distance);
    if (
      center.x < 0 ||
      center.y < 0 ||
      center.x >= image.width ||
      center.y >= image.height
    ) break;
    const present = maskAt(
      trustedSupportMask,
      image.width,
      image.height,
      center.x,
      center.y
    );
    unsupportedWalk = present ? 0 : unsupportedWalk + 1;

    const insideSupport = maskLineFraction(
      trustedSupportMask,
      image.width,
      image.height,
      origin,
      normal,
      distance - parameters.supportWindowStartPx,
      distance - parameters.supportWindowEndPx,
      true
    );
    const outsideExclusion = maskLineFraction(
      trustedSupportMask,
      image.width,
      image.height,
      origin,
      normal,
      distance + parameters.exclusionWindowStartPx,
      distance + parameters.exclusionWindowEndPx,
      false
    );
    const insideRawMaskSupport = maskLineFraction(
      rawRegionMask,
      image.width,
      image.height,
      origin,
      normal,
      distance - parameters.supportWindowStartPx,
      distance - parameters.supportWindowEndPx,
      true
    );
    const outsideRawMaskExclusion = maskLineFraction(
      rawRegionMask,
      image.width,
      image.height,
      origin,
      normal,
      distance + parameters.exclusionWindowStartPx,
      distance + parameters.exclusionWindowEndPx,
      false
    );
    const insideRgb = patchMeanRgb(
      image,
      pointAlong(origin, normal, distance - parameters.transitionOffsetPx),
      parameters.transitionPatchRadiusPx
    );
    const outsideRgb = patchMeanRgb(
      image,
      pointAlong(origin, normal, distance + parameters.transitionOffsetPx),
      parameters.transitionPatchRadiusPx
    );
    const transitionRgbDistance = rgbDistance(insideRgb, outsideRgb);
    const transitionLumaDistance = Math.abs(luma(insideRgb) - luma(outsideRgb));
    const candidateFrameDistance = frameDistance(
      center,
      image.width,
      image.height
    );
    if (
      insideSupport >= parameters.minimumInsideRegionSupportFraction &&
      outsideExclusion >= parameters.minimumOutsideRegionExclusionFraction &&
      transitionRgbDistance >= parameters.minimumTransitionRgbDistance &&
      transitionLumaDistance >= parameters.minimumTransitionLumaDistance
    ) {
      plausible.push(Object.freeze({
        contourIndex,
        coreOrigin: Object.freeze(origin),
        point: Object.freeze(center),
        normal,
        searchDistancePx: distance,
        insideRegionSupportFraction: insideSupport,
        outsideRegionExclusionFraction: outsideExclusion,
        insideRawMaskSupportFraction: insideRawMaskSupport,
        outsideRawMaskExclusionFraction: outsideRawMaskExclusion,
        transitionRgbDistance,
        transitionLumaDistance,
        frameDistancePx: candidateFrameDistance,
      }));
    }
    if (unsupportedWalk > parameters.maximumUnsupportedWalkPx) break;
  }
  if (plausible.length === 0) return { state: "no_supported_transition" };

  const firstDistance = plausible[0].searchDistancePx;
  const firstCluster = plausible.filter(sample =>
    sample.searchDistancePx - firstDistance <= parameters.transitionOffsetPx * 2
  );
  const selected = firstCluster.reduce((best, sample) =>
    sample.transitionRgbDistance > best.transitionRgbDistance ? sample : best
  );
  const later = plausible.find(sample =>
    sample.searchDistancePx - selected.searchDistancePx >=
      parameters.ambiguitySeparationPx &&
    sample.transitionRgbDistance >=
      selected.transitionRgbDistance * parameters.ambiguityScoreRatio
  );
  if (later) return { state: "ambiguous_transition" };
  if (selected.frameDistancePx <= parameters.imageFrameMarginPx) {
    return { state: "frame_proximity" };
  }
  return { state: "accepted", sample: selected };
}

function pointDistance(left: PixelPoint, right: PixelPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function vectorDot(left: Vector, right: Vector): number {
  return left.x * right.x + left.y * right.y;
}

function polylineLength(points: readonly PixelPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += pointDistance(points[index - 1], points[index]);
  }
  return length;
}

function turnAngleDeg(
  first: PixelPoint,
  middle: PixelPoint,
  last: PixelPoint
): number {
  const incoming = normalizedVector({
    x: middle.x - first.x,
    y: middle.y - first.y,
  });
  const outgoing = normalizedVector({
    x: last.x - middle.x,
    y: last.y - middle.y,
  });
  if (!incoming || !outgoing) return 180;
  return Math.acos(Math.max(-1, Math.min(1, vectorDot(incoming, outgoing)))) *
    180 / Math.PI;
}

function splitContactSamples(
  samples: readonly ContactSample[],
  parameters: VisibleFloorContactLocalizerParameters
): readonly ContactSample[][] {
  const chains: ContactSample[][] = [];
  let current: ContactSample[] = [];
  const finish = () => {
    if (current.length > 0) chains.push(current);
    current = [];
  };
  for (const sample of samples) {
    const previous = current.at(-1);
    if (
      previous &&
      (
        sample.contourIndex - previous.contourIndex >
          parameters.maximumContourSampleGap *
            parameters.frontierSampleStridePx ||
        pointDistance(previous.point, sample.point) >
          parameters.maximumCandidateNeighborStepPx ||
        vectorDot(previous.normal, sample.normal) <
          parameters.minimumNeighborNormalDot
      )
    ) finish();
    const beforePrevious = current.at(-2);
    if (
      beforePrevious &&
      previous &&
      turnAngleDeg(beforePrevious.point, previous.point, sample.point) >
        parameters.maximumChainTurnDeg
    ) finish();
    current.push(sample);
  }
  finish();
  return Object.freeze(chains);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizePoint(
  point: PixelPoint,
  width: number,
  height: number
): VisibleFloorContactPoint {
  return Object.freeze({ x: point.x / width, y: point.y / height });
}

function fragmentFromChain(
  chain: readonly ContactSample[],
  index: number,
  region: EmptyVisibleFloorRegion
): VisibleFloorTerminationFragment {
  const points = Object.freeze(chain.map(sample =>
    normalizePoint(sample.point, region.dimensions.width, region.dimensions.height)
  ));
  const maximumNeighborStepPx = chain.slice(1).reduce(
    (maximum, sample, sampleIndex) => Math.max(
      maximum,
      pointDistance(chain[sampleIndex].point, sample.point)
    ),
    0
  );
  const endpoint = (point: VisibleFloorContactPoint) => Object.freeze({
    state: "uncertain_support_limit" as const,
    pointSourceNormalized: point,
  });
  return Object.freeze({
    id: `${VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION}:${region.roomId}:${String(index).padStart(4, "0")}`,
    roomId: region.roomId,
    emptyImageSha256: region.emptyImageSha256,
    coordinateSpace: VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE,
    proposalVersion: VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION,
    geometryKind: "finite_open_visible_floor_termination",
    pointsSourceNormalized: points,
    startEndpoint: endpoint(points[0]),
    endEndpoint: endpoint(points.at(-1) ?? points[0]),
    evidence: Object.freeze({
      sourceRegionVersion: EMPTY_VISIBLE_FLOOR_REGION_VERSION,
      interiorSupportRule:
        "seed_connected_local_appearance_continuity_with_thin_reconciliation",
      outwardDirectionRule: "local_core_contour_normal",
      transitionRule: "first_supported_outward_appearance_transition",
      sourcePixelLength: polylineLength(chain.map(sample => sample.point)),
      contactSampleCount: chain.length,
      meanSearchDistancePx: mean(chain.map(sample => sample.searchDistancePx)),
      maximumNeighborStepPx,
      meanInsideRegionSupportFraction: mean(
        chain.map(sample => sample.insideRegionSupportFraction)
      ),
      meanOutsideRegionExclusionFraction: mean(
        chain.map(sample => sample.outsideRegionExclusionFraction)
      ),
      meanInsideRawMaskSupportFraction: mean(
        chain.map(sample => sample.insideRawMaskSupportFraction)
      ),
      meanOutsideRawMaskExclusionFraction: mean(
        chain.map(sample => sample.outsideRawMaskExclusionFraction)
      ),
      coreOriginStartSourcePx: Object.freeze(chain[0].coreOrigin),
      coreOriginEndSourcePx: Object.freeze(
        chain.at(-1)?.coreOrigin ?? chain[0].coreOrigin
      ),
      meanOutwardNormal: Object.freeze({
        x: mean(chain.map(sample => sample.normal.x)),
        y: mean(chain.map(sample => sample.normal.y)),
      }),
      meanTransitionRgbDistance: mean(
        chain.map(sample => sample.transitionRgbDistance)
      ),
      minimumTransitionRgbDistance: Math.min(
        ...chain.map(sample => sample.transitionRgbDistance)
      ),
      minimumFrameDistancePx: Math.min(
        ...chain.map(sample => sample.frameDistancePx)
      ),
    }),
  });
}

/**
 * Localizes only finite image-space evidence. The source region is copied
 * nowhere and mutated nowhere. The closed support contour is merely a search
 * scaffold; only gap-bounded accepted runs become open output fragments.
 */
export function localizeVisibleFloorTerminationFragments(
  image: VisibleFloorContactDecodedImage,
  region: EmptyVisibleFloorRegion,
  parameters: VisibleFloorContactLocalizerParameters =
    P2_S2D_VISIBLE_FLOOR_CONTACT_PARAMETERS
): VisibleFloorContactLocalization | null {
  if (
    image.width !== region.dimensions.width ||
    image.height !== region.dimensions.height ||
    image.channels < 3 ||
    image.pixels.length < image.width * image.height * image.channels
  ) return null;
  const appearanceSeed = Object.freeze({
    x: Math.round(region.seed.pointSourcePx.x),
    y: Math.round(region.seed.pointSourcePx.y),
  });
  const trustedSupport = reconciledTrustedSupport(
    image,
    region.componentMask,
    appearanceSeed,
    parameters
  );
  if (!trustedSupport) return null;
  const coreMask = trustedSupport.mask;
  const coreSeed = nearestPresentPixel(
    coreMask,
    image.width,
    image.height,
    appearanceSeed
  );
  if (!coreSeed) return null;
  const corePixelCount = coreMask.reduce(
    (count, value) => count + (value === 0 ? 0 : 1),
    0
  );
  const external = externalEmptyMask(coreMask, image.width, image.height);
  const loops = tracedLoops(directedOuterEdges(
    coreMask,
    external,
    image.width,
    image.height
  ));
  const contour = loops.reduce<PixelPoint[]>(
    (longest, loop) => loop.length > longest.length ? loop : longest,
    []
  );
  if (contour.length < 4) return null;

  const accepted: ContactSample[] = [];
  const rejected = {
    noOutwardNormal: 0,
    noSupportedTransition: 0,
    ambiguousTransition: 0,
    frameProximity: 0,
    shortChain: 0,
  };
  let sampledFrontierCount = 0;
  for (
    let contourIndex = 0;
    contourIndex < contour.length;
    contourIndex += parameters.frontierSampleStridePx
  ) {
    sampledFrontierCount += 1;
    const search = searchCandidate(
      contour,
      contourIndex,
      image,
      region.componentMask,
      trustedSupport.mask,
      coreMask,
      parameters
    );
    if (search.state === "accepted") {
      accepted.push(search.sample);
    } else if (search.state === "no_outward_normal") {
      rejected.noOutwardNormal += 1;
    } else if (search.state === "no_supported_transition") {
      rejected.noSupportedTransition += 1;
    } else if (search.state === "ambiguous_transition") {
      rejected.ambiguousTransition += 1;
    } else {
      rejected.frameProximity += 1;
    }
  }

  const fragments: VisibleFloorTerminationFragment[] = [];
  for (const chain of splitContactSamples(accepted, parameters)) {
    if (
      chain.length < parameters.minimumFragmentSamples ||
      polylineLength(chain.map(sample => sample.point)) <
        parameters.minimumFragmentLengthPx
    ) {
      rejected.shortChain += 1;
      continue;
    }
    const candidate = fragmentFromChain(chain, fragments.length, region);
    const first = candidate.pointsSourceNormalized[0];
    const last = candidate.pointsSourceNormalized.at(-1);
    if (
      !last ||
      (
        candidate.pointsSourceNormalized.length > 2 &&
        first.x === last.x &&
        first.y === last.y
      )
    ) continue;
    fragments.push(candidate);
  }
  return Object.freeze({
    region,
    parameters,
    fragments: Object.freeze(fragments),
    diagnostics: Object.freeze({
      rawRegionPixelCount: region.componentPixelCount,
      appearanceContinuousPixelCount: trustedSupport.baseCount,
      appearanceContinuityRejectedEdgeCount: trustedSupport.rejectedEdgeCount,
      stripeReturnRestoredPixelCount:
        trustedSupport.stripeReturnRestoredPixelCount,
      thinComponentRestoredPixelCount:
        trustedSupport.thinComponentRestoredPixelCount,
      supportComponents: trustedSupport.components,
      coreSeedSourcePx: Object.freeze(coreSeed),
      corePixelCount,
      coreContourPointCount: contour.length,
      sampledFrontierCount,
      supportedTransitionCount: accepted.length,
      fragmentCount: fragments.length,
      rejected: Object.freeze(rejected),
    }),
  });
}

export async function readCertifiedVisibleFloorTerminationFragments(
  imageBytes: Uint8Array,
  sourceIdentity: CertifiedEmptyVisibleFloorSourceIdentity,
  regionParameters: EmptyVisibleFloorRegionParameters =
    P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  localizerParameters: VisibleFloorContactLocalizerParameters =
    P2_S2D_VISIBLE_FLOOR_CONTACT_PARAMETERS
): Promise<VisibleFloorContactReadResult> {
  const regionRead = await readCertifiedEmptyVisibleFloorRegion(
    imageBytes,
    sourceIdentity,
    regionParameters
  );
  if (!regionRead.ok) return regionRead;
  try {
    const decoded = await sharp(imageBytes)
      .removeAlpha()
      .blur(1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const localization = localizeVisibleFloorTerminationFragments(
      Object.freeze({
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        pixels: decoded.data,
      }),
      regionRead.region,
      localizerParameters
    );
    return localization
      ? Object.freeze({ ok: true, localization })
      : { ok: false, reason: "empty_conservative_core" };
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
}
