import sharp from "sharp";

import {
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
  type EmptyPhysicalBoundaryEndpointStatus,
  type EmptyPhysicalBoundaryFixture,
  type EmptyPhysicalBoundaryFrameContact,
  type EmptyPhysicalBoundaryState,
} from "./empty-physical-boundary-read";
import {
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  type DiagnosticPerimeterSpan,
  type EmptyVisibleFloorRegion,
  type EmptyVisibleFloorRegionParameters,
  type Rgb,
  type SourcePixelPoint,
  readCertifiedEmptyVisibleFloorRegion,
} from "./empty-visible-floor-region";

type SourcePoint = Readonly<{ x: number; y: number }>;
type PixelPolyline = readonly SourcePoint[];

export const EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION =
  "p2-s2a-region-boundary-fragments/v1" as const;

export type BoundaryFragmentClassificationReason =
  | "verified_floor_termination"
  | "image_frame_contact"
  | "insufficient_finite_support"
  | "irregular_region_perimeter"
  | "inside_not_seed_floor_like"
  | "outside_still_floor_like"
  | "weak_inside_outside_transition"
  | "unsupported_region_sides";

export type EmptyRegionBoundaryFragmentParameters = Readonly<{
  classificationWindowColumns: number;
  minimumPhysicalSupportPx: number;
  sampleStridePx: number;
  patchRadiusPx: number;
  insideOffsetPx: number;
  outsideOffsetPx: number;
  maximumLineResidualPx: number;
  maximumInsideSeedRgbDistance: number;
  minimumInsideFloorLikeFraction: number;
  maximumOutsideFloorLikeFraction: number;
  minimumOutsideSeedRgbDistance: number;
  minimumMeanLumaDrop: number;
  minimumMeanRgbDistance: number;
  minimumMeanWarmChromaDrop: number;
  minimumInsideRegionSupportFraction: number;
  minimumOutsideRegionExclusionFraction: number;
  imageBorderMarginPx: number;
}>;

/**
 * One global fail-closed verifier for A/C/E. Windows are classified
 * independently: a rejected/unknown window is never interpolated or bridged.
 */
export const P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS: EmptyRegionBoundaryFragmentParameters =
  Object.freeze({
    classificationWindowColumns: 48,
    minimumPhysicalSupportPx: 48,
    sampleStridePx: 4,
    patchRadiusPx: 2,
    insideOffsetPx: 8,
    outsideOffsetPx: 8,
    maximumLineResidualPx: 4,
    maximumInsideSeedRgbDistance: 55,
    minimumInsideFloorLikeFraction: 0.75,
    maximumOutsideFloorLikeFraction: 0.2,
    minimumOutsideSeedRgbDistance: 18,
    minimumMeanLumaDrop: 20,
    minimumMeanRgbDistance: 30,
    minimumMeanWarmChromaDrop: 3,
    minimumInsideRegionSupportFraction: 0.8,
    minimumOutsideRegionExclusionFraction: 0.8,
    imageBorderMarginPx: 2,
  });

export type BoundaryFragmentVerification = Readonly<{
  sourcePixelLength: number;
  sourcePixelXSpan: number;
  sampleCount: number;
  maximumLineResidualPx: number | null;
  insideFloorLikeFraction: number | null;
  outsideFloorLikeFraction: number | null;
  meanInsideSeedRgbDistance: number | null;
  meanOutsideSeedRgbDistance: number | null;
  meanOutsideToInsideLumaDrop: number | null;
  meanOutsideToInsideRgbDistance: number | null;
  meanInsideToOutsideWarmChromaDrop: number | null;
  insideRegionSupportFraction: number | null;
  outsideRegionExclusionFraction: number | null;
}>;

export type EmptyRegionBoundaryFragment = Readonly<{
  id: string;
  roomId: string;
  emptyImageSha256: string;
  coordinateSpace: typeof EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE;
  proposalVersion: typeof EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION;
  sourceRegionVersion: typeof EMPTY_VISIBLE_FLOOR_REGION_VERSION;
  sourcePerimeterSpanId: string;
  geometryKind: "finite_open_observed_perimeter_span";
  boundaryState: Extract<
    EmptyPhysicalBoundaryState,
    "physical_wall" | "frame_truncated" | "unknown"
  >;
  classificationReasons: readonly BoundaryFragmentClassificationReason[];
  startEndpoint: Readonly<{
    status: EmptyPhysicalBoundaryEndpointStatus;
    frameContact: EmptyPhysicalBoundaryFrameContact;
  }>;
  endEndpoint: Readonly<{
    status: EmptyPhysicalBoundaryEndpointStatus;
    frameContact: EmptyPhysicalBoundaryFrameContact;
  }>;
  touchesImageFrame: boolean;
  pointsSourceNormalized: readonly SourcePoint[];
  verification: BoundaryFragmentVerification;
}>;

export type EmptyRegionBoundaryFragmentReadResult =
  | Readonly<{
      ok: true;
      region: EmptyVisibleFloorRegion;
      regionParameters: EmptyVisibleFloorRegionParameters;
      fragmentParameters: EmptyRegionBoundaryFragmentParameters;
      fragments: readonly EmptyRegionBoundaryFragment[];
      physicalWallFragments: readonly EmptyRegionBoundaryFragment[];
    }>
  | Readonly<{
      ok: false;
      reason:
        | "decode_failed"
        | "fixture_identity_mismatch"
        | "lower_center_seed_not_floor_like"
        | "empty_seed_component";
    }>;

type DecodedRgb = Readonly<{
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}>;

type AppearanceSample = Readonly<{
  insideRgb: Rgb;
  outsideRgb: Rgb;
  insideSeedDistance: number;
  outsideSeedDistance: number;
  insideFloorLike: boolean;
  outsideFloorLike: boolean;
  insideRegion: boolean;
  outsideRegion: boolean;
}>;

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function freezeReasons(
  ...values: BoundaryFragmentClassificationReason[]
): readonly BoundaryFragmentClassificationReason[] {
  return Object.freeze(values);
}

function rgbLuma(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function warmChroma(rgb: Rgb): number {
  return rgb[0] - rgb[2];
}

function rgbDistance(left: Rgb, right: Rgb): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  );
}

function nearestPrototypeDistance(
  rgb: Rgb,
  prototypes: readonly Rgb[]
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const prototype of prototypes) {
    minimum = Math.min(minimum, rgbDistance(rgb, prototype));
  }
  return minimum;
}

function patchMeanRgb(
  image: DecodedRgb,
  centerX: number,
  centerY: number,
  radius: number
): Rgb {
  const xMinimum = Math.max(0, centerX - radius);
  const xMaximum = Math.min(image.width - 1, centerX + radius);
  const yMinimum = Math.max(0, centerY - radius);
  const yMaximum = Math.min(image.height - 1, centerY + radius);
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = yMinimum; y <= yMaximum; y += 1) {
    for (let x = xMinimum; x <= xMaximum; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      red += image.pixels[offset];
      green += image.pixels[offset + 1];
      blue += image.pixels[offset + 2];
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

function polylineLength(points: readonly SourcePixelPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    );
  }
  return length;
}

function lineResidual(points: readonly SourcePixelPoint[]): number | null {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce(
    (sum, point) => sum + (point.x - meanX) ** 2,
    0
  );
  if (denominator <= 0) return null;
  const slope = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0
  ) / denominator;
  const intercept = meanY - slope * meanX;
  return Math.max(
    ...points.map(point => Math.abs(point.y - (slope * point.x + intercept)))
  );
}

function touchesBorder(
  points: readonly SourcePixelPoint[],
  dimensions: Readonly<{ width: number; height: number }>,
  margin: number
): boolean {
  return points.some(point =>
    point.x <= margin ||
    point.y <= margin ||
    point.x >= dimensions.width - 1 - margin ||
    point.y >= dimensions.height - 1 - margin
  );
}

function normalized(
  points: readonly SourcePixelPoint[],
  dimensions: Readonly<{ width: number; height: number }>
): readonly SourcePoint[] {
  return Object.freeze(points.map(point => Object.freeze({
    x: point.x / dimensions.width,
    y: point.y / dimensions.height,
  })));
}

function chunkUpperSpan(
  span: DiagnosticPerimeterSpan,
  windowColumns: number
): readonly (readonly SourcePixelPoint[])[] {
  const chunks: SourcePixelPoint[][] = [];
  for (let start = 0; start < span.pointsSourcePx.length; start += windowColumns) {
    chunks.push(span.pointsSourcePx.slice(start, start + windowColumns));
  }
  return Object.freeze(chunks.map(chunk => Object.freeze(chunk)));
}

function nullVerification(
  points: readonly SourcePixelPoint[]
): BoundaryFragmentVerification {
  const first = points[0];
  const last = points.at(-1) ?? first;
  return Object.freeze({
    sourcePixelLength: polylineLength(points),
    sourcePixelXSpan: first && last ? Math.abs(last.x - first.x) : 0,
    sampleCount: 0,
    maximumLineResidualPx: lineResidual(points),
    insideFloorLikeFraction: null,
    outsideFloorLikeFraction: null,
    meanInsideSeedRgbDistance: null,
    meanOutsideSeedRgbDistance: null,
    meanOutsideToInsideLumaDrop: null,
    meanOutsideToInsideRgbDistance: null,
    meanInsideToOutsideWarmChromaDrop: null,
    insideRegionSupportFraction: null,
    outsideRegionExclusionFraction: null,
  });
}

function classifyUpperChunk(
  points: readonly SourcePixelPoint[],
  image: DecodedRgb,
  region: EmptyVisibleFloorRegion,
  parameters: EmptyRegionBoundaryFragmentParameters
): Readonly<{
  boundaryState: "physical_wall" | "frame_truncated" | "unknown";
  reasons: readonly BoundaryFragmentClassificationReason[];
  verification: BoundaryFragmentVerification;
}> {
  const length = polylineLength(points);
  const first = points[0];
  const last = points.at(-1) ?? first;
  const xSpan = first && last ? Math.abs(last.x - first.x) : 0;
  const residual = lineResidual(points);
  if (
    touchesBorder(points, region.dimensions, parameters.imageBorderMarginPx)
  ) {
    return Object.freeze({
      boundaryState: "frame_truncated",
      reasons: freezeReasons("image_frame_contact"),
      verification: nullVerification(points),
    });
  }

  const samples: AppearanceSample[] = [];
  for (
    let index = 0;
    index < points.length;
    index += parameters.sampleStridePx
  ) {
    const point = points[index];
    const insideY = Math.min(
      image.height - 1,
      point.y + parameters.insideOffsetPx
    );
    const outsideY = Math.max(0, point.y - parameters.outsideOffsetPx);
    const insideRgb = patchMeanRgb(
      image,
      point.x,
      insideY,
      parameters.patchRadiusPx
    );
    const outsideRgb = patchMeanRgb(
      image,
      point.x,
      outsideY,
      parameters.patchRadiusPx
    );
    const insideSeedDistance = nearestPrototypeDistance(
      insideRgb,
      region.seed.appearancePrototypes
    );
    const outsideSeedDistance = nearestPrototypeDistance(
      outsideRgb,
      region.seed.appearancePrototypes
    );
    const insideFloorLike =
      insideSeedDistance <= parameters.maximumInsideSeedRgbDistance &&
      warmChroma(insideRgb) >= region.seed.effectiveMinimumWarmChroma;
    const outsideFloorLike =
      outsideSeedDistance <= parameters.maximumInsideSeedRgbDistance &&
      warmChroma(outsideRgb) >= region.seed.effectiveMinimumWarmChroma;
    samples.push(Object.freeze({
      insideRgb,
      outsideRgb,
      insideSeedDistance,
      outsideSeedDistance,
      insideFloorLike,
      outsideFloorLike,
      insideRegion:
        region.componentMask[insideY * image.width + point.x] !== 0,
      outsideRegion:
        region.componentMask[outsideY * image.width + point.x] !== 0,
    }));
  }

  const fraction = (predicate: (sample: AppearanceSample) => boolean) =>
    samples.length === 0
      ? 0
      : samples.filter(predicate).length / samples.length;
  const insideFloorLikeFraction = fraction(sample => sample.insideFloorLike);
  const outsideFloorLikeFraction = fraction(sample => sample.outsideFloorLike);
  const insideRegionSupportFraction = fraction(sample => sample.insideRegion);
  const outsideRegionExclusionFraction = fraction(sample => !sample.outsideRegion);
  const meanInsideSeedRgbDistance = mean(
    samples.map(sample => sample.insideSeedDistance)
  );
  const meanOutsideSeedRgbDistance = mean(
    samples.map(sample => sample.outsideSeedDistance)
  );
  const meanOutsideToInsideLumaDrop = mean(samples.map(sample =>
    rgbLuma(sample.outsideRgb) - rgbLuma(sample.insideRgb)
  ));
  const meanOutsideToInsideRgbDistance = mean(samples.map(sample =>
    rgbDistance(sample.outsideRgb, sample.insideRgb)
  ));
  const meanInsideToOutsideWarmChromaDrop = mean(samples.map(sample =>
    warmChroma(sample.insideRgb) - warmChroma(sample.outsideRgb)
  ));
  const verification: BoundaryFragmentVerification = Object.freeze({
    sourcePixelLength: length,
    sourcePixelXSpan: xSpan,
    sampleCount: samples.length,
    maximumLineResidualPx: residual,
    insideFloorLikeFraction,
    outsideFloorLikeFraction,
    meanInsideSeedRgbDistance,
    meanOutsideSeedRgbDistance,
    meanOutsideToInsideLumaDrop,
    meanOutsideToInsideRgbDistance,
    meanInsideToOutsideWarmChromaDrop,
    insideRegionSupportFraction,
    outsideRegionExclusionFraction,
  });
  const reasons: BoundaryFragmentClassificationReason[] = [];
  if (length < parameters.minimumPhysicalSupportPx || points.length < 2) {
    reasons.push("insufficient_finite_support");
  }
  if (residual === null || residual > parameters.maximumLineResidualPx) {
    reasons.push("irregular_region_perimeter");
  }
  if (
    insideFloorLikeFraction < parameters.minimumInsideFloorLikeFraction ||
    meanInsideSeedRgbDistance === null ||
    meanInsideSeedRgbDistance > parameters.maximumInsideSeedRgbDistance
  ) reasons.push("inside_not_seed_floor_like");
  if (
    outsideFloorLikeFraction > parameters.maximumOutsideFloorLikeFraction ||
    meanOutsideSeedRgbDistance === null ||
    meanOutsideSeedRgbDistance < parameters.minimumOutsideSeedRgbDistance
  ) reasons.push("outside_still_floor_like");
  if (
    meanOutsideToInsideLumaDrop === null ||
    meanOutsideToInsideLumaDrop < parameters.minimumMeanLumaDrop ||
    meanOutsideToInsideRgbDistance === null ||
    meanOutsideToInsideRgbDistance < parameters.minimumMeanRgbDistance ||
    meanInsideToOutsideWarmChromaDrop === null ||
    meanInsideToOutsideWarmChromaDrop <
      parameters.minimumMeanWarmChromaDrop
  ) reasons.push("weak_inside_outside_transition");
  if (
    insideRegionSupportFraction <
      parameters.minimumInsideRegionSupportFraction ||
    outsideRegionExclusionFraction <
      parameters.minimumOutsideRegionExclusionFraction
  ) reasons.push("unsupported_region_sides");

  return Object.freeze({
    boundaryState: reasons.length === 0 ? "physical_wall" : "unknown",
    reasons: reasons.length === 0
      ? freezeReasons("verified_floor_termination")
      : Object.freeze(reasons),
    verification,
  });
}

function endpoints(
  state: EmptyRegionBoundaryFragment["boundaryState"]
): Readonly<{
  startEndpoint: EmptyRegionBoundaryFragment["startEndpoint"];
  endEndpoint: EmptyRegionBoundaryFragment["endEndpoint"];
}> {
  const status: EmptyPhysicalBoundaryEndpointStatus =
    state === "frame_truncated" ? "frame_truncated" : "visible";
  const frameContact: EmptyPhysicalBoundaryFrameContact =
    state === "frame_truncated" ? "contacts_frame" : "no_frame_contact";
  const endpoint = Object.freeze({ status, frameContact });
  return Object.freeze({ startEndpoint: endpoint, endEndpoint: endpoint });
}

function fragment(
  input: Readonly<{
    index: number;
    sourceSpan: DiagnosticPerimeterSpan;
    points: readonly SourcePixelPoint[];
    region: EmptyVisibleFloorRegion;
    classification: Readonly<{
      boundaryState: "physical_wall" | "frame_truncated" | "unknown";
      reasons: readonly BoundaryFragmentClassificationReason[];
      verification: BoundaryFragmentVerification;
    }>;
  }>
): EmptyRegionBoundaryFragment {
  const endpointValues = endpoints(input.classification.boundaryState);
  return Object.freeze({
    id: `${EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION}:${input.region.roomId}:${String(input.index).padStart(4, "0")}`,
    roomId: input.region.roomId,
    emptyImageSha256: input.region.emptyImageSha256,
    coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
    proposalVersion: EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION,
    sourceRegionVersion: input.region.version,
    sourcePerimeterSpanId: input.sourceSpan.id,
    geometryKind: "finite_open_observed_perimeter_span",
    boundaryState: input.classification.boundaryState,
    classificationReasons: input.classification.reasons,
    ...endpointValues,
    touchesImageFrame: touchesBorder(
      input.points,
      input.region.dimensions,
      0
    ),
    pointsSourceNormalized: normalized(
      input.points,
      input.region.dimensions
    ),
    verification: input.classification.verification,
  });
}

/**
 * Classifies only observed region-perimeter windows. No oracle, camera,
 * closure, convex hull, continuation, or cross-window interpolation is used.
 */
export function classifyEmptyRegionBoundaryFragments(
  image: DecodedRgb,
  region: EmptyVisibleFloorRegion,
  parameters: EmptyRegionBoundaryFragmentParameters =
    P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS
): readonly EmptyRegionBoundaryFragment[] {
  const fragments: EmptyRegionBoundaryFragment[] = [];
  for (const span of region.upperPerimeterSpans) {
    for (const points of chunkUpperSpan(
      span,
      parameters.classificationWindowColumns
    )) {
      if (points.length < 2) continue;
      fragments.push(fragment({
        index: fragments.length,
        sourceSpan: span,
        points,
        region,
        classification: classifyUpperChunk(
          points,
          image,
          region,
          parameters
        ),
      }));
    }
  }
  for (const span of region.frameContactSpans) {
    if (span.pointsSourcePx.length < 2) continue;
    fragments.push(fragment({
      index: fragments.length,
      sourceSpan: span,
      points: span.pointsSourcePx,
      region,
      classification: Object.freeze({
        boundaryState: "frame_truncated",
        reasons: freezeReasons("image_frame_contact"),
        verification: nullVerification(span.pointsSourcePx),
      }),
    }));
  }
  return Object.freeze(fragments);
}

export async function readCertifiedEmptyRegionBoundaryFragments(
  imageBytes: Uint8Array,
  fixture: EmptyPhysicalBoundaryFixture,
  regionParameters: EmptyVisibleFloorRegionParameters =
    P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  fragmentParameters: EmptyRegionBoundaryFragmentParameters =
    P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS
): Promise<EmptyRegionBoundaryFragmentReadResult> {
  const regionRead = await readCertifiedEmptyVisibleFloorRegion(
    imageBytes,
    fixture,
    regionParameters
  );
  if (!regionRead.ok) return regionRead;
  try {
    const decoded = await sharp(imageBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== regionRead.region.dimensions.width ||
      decoded.info.height !== regionRead.region.dimensions.height ||
      decoded.info.channels < 3
    ) return { ok: false, reason: "fixture_identity_mismatch" };
    const fragments = classifyEmptyRegionBoundaryFragments(
      Object.freeze({
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        pixels: decoded.data,
      }),
      regionRead.region,
      fragmentParameters
    );
    return Object.freeze({
      ok: true,
      region: regionRead.region,
      regionParameters,
      fragmentParameters,
      fragments,
      physicalWallFragments: Object.freeze(fragments.filter(
        item => item.boundaryState === "physical_wall"
      )),
    });
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
}

/**
 * Local evaluator-only finite-polyline helpers. These intentionally preserve
 * P2-S1B's audited sampling and clamped-segment distance semantics without
 * making the P2-S2A evaluator an importer of the certified detector module.
 */
function toPixelPolyline(
  points: readonly SourcePoint[],
  width: number,
  height: number
): PixelPolyline {
  return points.map(point => ({
    x: point.x * width,
    y: point.y * height,
  }));
}

function samplePolyline(
  points: PixelPolyline,
  spacingPx = 1
): readonly SourcePoint[] {
  const samples: SourcePoint[] = [];
  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
    const start = points[segmentIndex - 1];
    const end = points[segmentIndex];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / spacingPx));
    for (
      let step = segmentIndex === 1 ? 0 : 1;
      step <= steps;
      step += 1
    ) {
      const t = step / steps;
      samples.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
    }
  }
  return samples;
}

function pointToFiniteSegmentDistance(
  point: SourcePoint,
  start: SourcePoint,
  end: SourcePoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared
    )
  );
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy)
  );
}

function pointToFinitePolylinesDistance(
  point: SourcePoint,
  polylines: readonly PixelPolyline[]
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const polyline of polylines) {
    for (let index = 1; index < polyline.length; index += 1) {
      minimum = Math.min(
        minimum,
        pointToFiniteSegmentDistance(
          point,
          polyline[index - 1],
          polyline[index]
        )
      );
    }
  }
  return minimum;
}

type TrustedOracle = Readonly<{
  id: string;
  interpretation: string;
  polyline: PixelPolyline;
}>;

export type EmptyRegionBoundaryFragmentSupport = Readonly<{
  fragmentId: string;
  sourcePixelLength: number;
  sampleCount: number;
  insideCorridorSampleCount: number;
  outsideCorridorSampleCount: number;
  supportedSampleFraction: number;
  meanInsideCorridorDistancePx: number | null;
  maximumDistancePx: number | null;
  supportedAnnotationIds: readonly string[];
  supportedSideAnnotationIds: readonly string[];
  supportedRearAnnotationIds: readonly string[];
}>;

export type EmptyRegionBoundaryHardFailures = Readonly<{
  offOraclePhysicalGeometry: boolean;
  roomCIllegalBridge: boolean;
  roomCOccluderContourPhysical: boolean;
  imageBorderPhysicalWall: boolean;
  roomEInventedSideRearChord: boolean;
  hiddenContinuation: boolean;
  forcedClosure: boolean;
}>;

export type EmptyRegionBoundaryRoomEvaluation = Readonly<{
  roomId: string;
  regionPixelCount: number;
  regionFraction: number;
  upperPerimeterSpanCount: number;
  physicalWallFragmentCount: number;
  unknownFragmentCount: number;
  frameTruncatedFragmentCount: number;
  physicalWallSourcePixelLength: number;
  physicalSamplesInsideCorridor: number;
  physicalSamplesOutsideCorridor: number;
  physicalLengthInsideCorridorApproxPx: number;
  physicalLengthOutsideCorridorApproxPx: number;
  acceptedFragmentSupport: readonly EmptyRegionBoundaryFragmentSupport[];
  usefulOnCorridorPhysicalFragmentCount: number;
  oracleCoverageFraction: number;
  roomCRadiatorGapRemainsOpen: boolean;
  hardFailures: EmptyRegionBoundaryHardFailures;
  hardFail: boolean;
}>;

function trustedOracles(
  fixture: EmptyPhysicalBoundaryFixture
): readonly TrustedOracle[] {
  const { width, height } = fixture.emptyImage.dimensions;
  return Object.freeze(fixture.annotations
    .filter(annotation =>
      annotation.collisionEligible &&
      annotation.boundaryState === "physical_wall" &&
      annotation.evidenceKind === "direct_visible"
    )
    .map(annotation => Object.freeze({
      id: annotation.id,
      interpretation: annotation.interpretation,
      polyline: toPixelPolyline(
        annotation.pointsSourceNormalized,
        width,
        height
      ),
    })));
}

function fragmentPixelPolyline(
  fragmentValue: EmptyRegionBoundaryFragment,
  fixture: EmptyPhysicalBoundaryFixture
): PixelPolyline {
  return toPixelPolyline(
    fragmentValue.pointsSourceNormalized,
    fixture.emptyImage.dimensions.width,
    fixture.emptyImage.dimensions.height
  );
}

/**
 * Post-hoc EMPTY-space scorer. Only physical_wall fragments are measured
 * against collision-eligible P2-S1A finite polylines and the unchanged 6 px
 * fixture corridor.
 */
export function evaluateEmptyRegionBoundaryFragments(
  read: Pick<
    Extract<EmptyRegionBoundaryFragmentReadResult, { ok: true }>,
    "region" | "fragments"
  >,
  fixture: EmptyPhysicalBoundaryFixture
): EmptyRegionBoundaryRoomEvaluation {
  const oracles = trustedOracles(fixture);
  const physical = read.fragments.filter(
    fragmentValue => fragmentValue.boundaryState === "physical_wall"
  );
  const physicalSamples = physical.map(fragmentValue =>
    samplePolyline(fragmentPixelPolyline(fragmentValue, fixture))
  );
  const supports = physical.map((fragmentValue, fragmentIndex) => {
    const samples = physicalSamples[fragmentIndex];
    const distances = samples.map(sample =>
      pointToFinitePolylinesDistance(
        sample,
        oracles.map(oracle => oracle.polyline)
      )
    );
    const inside = distances.filter(
      distance => distance <= fixture.evaluationCorridorSourcePx
    );
    const supported = oracles.filter(oracle =>
      samples.some(sample =>
        pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
          fixture.evaluationCorridorSourcePx
      )
    );
    return Object.freeze({
      fragmentId: fragmentValue.id,
      sourcePixelLength: fragmentValue.verification.sourcePixelLength,
      sampleCount: samples.length,
      insideCorridorSampleCount: inside.length,
      outsideCorridorSampleCount: distances.length - inside.length,
      supportedSampleFraction:
        distances.length === 0 ? 0 : inside.length / distances.length,
      meanInsideCorridorDistancePx: mean(inside),
      maximumDistancePx:
        distances.length === 0 ? null : Math.max(...distances),
      supportedAnnotationIds: Object.freeze(supported.map(oracle => oracle.id)),
      supportedSideAnnotationIds: Object.freeze(supported
        .filter(oracle => oracle.interpretation === "side_wall_floor_seam")
        .map(oracle => oracle.id)),
      supportedRearAnnotationIds: Object.freeze(supported
        .filter(oracle => oracle.interpretation === "rear_floor_wall_seam")
        .map(oracle => oracle.id)),
    });
  });
  const physicalSamplesInsideCorridor = supports.reduce(
    (sum, support) => sum + support.insideCorridorSampleCount,
    0
  );
  const physicalSamplesOutsideCorridor = supports.reduce(
    (sum, support) => sum + support.outsideCorridorSampleCount,
    0
  );
  const physicalWallSourcePixelLength = physical.reduce(
    (sum, fragmentValue) =>
      sum + fragmentValue.verification.sourcePixelLength,
    0
  );
  const totalSamples =
    physicalSamplesInsideCorridor + physicalSamplesOutsideCorridor;
  const insideFraction =
    totalSamples === 0 ? 0 : physicalSamplesInsideCorridor / totalSamples;

  const rearOracles = oracles.filter(
    oracle => oracle.interpretation === "rear_floor_wall_seam"
  );
  const sortedRearBounds = rearOracles
    .map(oracle => ({
      minimumX: Math.min(...oracle.polyline.map(point => point.x)),
      maximumX: Math.max(...oracle.polyline.map(point => point.x)),
    }))
    .sort((left, right) => left.minimumX - right.minimumX);
  const roomCGaps = fixture.roomId === "room-c"
    ? sortedRearBounds.slice(1).map((current, index) =>
        [sortedRearBounds[index].maximumX, current.minimumX] as const
      )
    : [];
  const roomCIllegalBridge = fixture.roomId === "room-c" &&
    physicalSamples.some(samples => {
      const touchedRear = rearOracles.filter(oracle =>
        samples.some(sample =>
          pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
            fixture.evaluationCorridorSourcePx
        )
      );
      return touchedRear.length > 1;
    });
  const roomCOccluderContourPhysical = fixture.roomId === "room-c" &&
    physicalSamples.some(samples => roomCGaps.some(([gapStart, gapEnd]) =>
      samples.some(sample =>
        sample.x > gapStart &&
        sample.x < gapEnd &&
        pointToFinitePolylinesDistance(
          sample,
          oracles.map(oracle => oracle.polyline)
        ) > fixture.evaluationCorridorSourcePx
      )
    ));
  const imageBorderPhysicalWall = physical.some(fragmentValue =>
    fragmentValue.touchesImageFrame
  );
  const roomEInventedSideRearChord = fixture.roomId === "room-e" &&
    physicalSamples.some(samples => {
      const side = oracles.filter(
        oracle => oracle.interpretation === "side_wall_floor_seam"
      );
      const rear = oracles.filter(
        oracle => oracle.interpretation === "rear_floor_wall_seam"
      );
      const sharedCorners = side.flatMap(sideOracle =>
        sideOracle.polyline.flatMap(sidePoint =>
          rear.flatMap(rearOracle =>
            rearOracle.polyline
              .filter(rearPoint =>
                Math.hypot(
                  sidePoint.x - rearPoint.x,
                  sidePoint.y - rearPoint.y
                ) <= 1
              )
              .map(() => sidePoint)
          )
        )
      );
      const awayFromSharedCorner = (sample: SourcePoint) =>
        sharedCorners.length === 0 ||
        sharedCorners.every(corner =>
          Math.hypot(sample.x - corner.x, sample.y - corner.y) >
            fixture.evaluationCorridorSourcePx * 2
        );
      const meaningfulSideSupport = samples.some(sample =>
        awayFromSharedCorner(sample) &&
        side.some(oracle =>
          pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
            fixture.evaluationCorridorSourcePx
        )
      );
      const meaningfulRearSupport = samples.some(sample =>
        awayFromSharedCorner(sample) &&
        rear.some(oracle =>
          pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
            fixture.evaluationCorridorSourcePx
        )
      );
      return meaningfulSideSupport && meaningfulRearSupport;
    });
  const forcedClosure = physical.some(fragmentValue => {
    const first = fragmentValue.pointsSourceNormalized[0];
    const last = fragmentValue.pointsSourceNormalized.at(-1);
    return Boolean(
      first &&
      last &&
      fragmentValue.pointsSourceNormalized.length > 2 &&
      first.x === last.x &&
      first.y === last.y
    );
  });
  const hardFailures: EmptyRegionBoundaryHardFailures = Object.freeze({
    offOraclePhysicalGeometry: physicalSamplesOutsideCorridor > 0,
    roomCIllegalBridge,
    roomCOccluderContourPhysical,
    imageBorderPhysicalWall,
    roomEInventedSideRearChord,
    hiddenContinuation: false,
    forcedClosure,
  });
  const oracleSamples = oracles.flatMap(oracle =>
    samplePolyline(oracle.polyline)
  );
  const coveredOracleSamples = oracleSamples.filter(sample =>
    physicalSamples.some(samples =>
      pointToFinitePolylinesDistance(sample, [samples]) <=
        fixture.evaluationCorridorSourcePx
    )
  );
  return Object.freeze({
    roomId: fixture.roomId,
    regionPixelCount: read.region.componentPixelCount,
    regionFraction: read.region.componentFraction,
    upperPerimeterSpanCount: read.region.upperPerimeterSpans.length,
    physicalWallFragmentCount: physical.length,
    unknownFragmentCount: read.fragments.filter(
      item => item.boundaryState === "unknown"
    ).length,
    frameTruncatedFragmentCount: read.fragments.filter(
      item => item.boundaryState === "frame_truncated"
    ).length,
    physicalWallSourcePixelLength,
    physicalSamplesInsideCorridor,
    physicalSamplesOutsideCorridor,
    physicalLengthInsideCorridorApproxPx:
      physicalWallSourcePixelLength * insideFraction,
    physicalLengthOutsideCorridorApproxPx:
      physicalWallSourcePixelLength * (1 - insideFraction),
    acceptedFragmentSupport: Object.freeze(supports),
    usefulOnCorridorPhysicalFragmentCount: supports.filter(support =>
      support.sourcePixelLength >=
        P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS.minimumPhysicalSupportPx &&
      support.sampleCount > 0 &&
      support.outsideCorridorSampleCount === 0
    ).length,
    oracleCoverageFraction:
      oracleSamples.length === 0
        ? 0
        : coveredOracleSamples.length / oracleSamples.length,
    roomCRadiatorGapRemainsOpen:
      fixture.roomId !== "room-c" || !roomCOccluderContourPhysical,
    hardFailures,
    hardFail: Object.values(hardFailures).some(Boolean),
  });
}

export type P2S2ARegionFirstDecision =
  | "P2-S2A REGION-FIRST EXPERIMENT VIABLE"
  | "P2-S2A SAFE BUT NOT YET VIABLE"
  | "P2-S2A REGION-FIRST HYPOTHESIS FALSIFIED ON CERTIFIED CORPUS";

export function interpretP2S2ARegionFirstExperiment(
  evaluations: readonly EmptyRegionBoundaryRoomEvaluation[]
): P2S2ARegionFirstDecision {
  if (evaluations.some(evaluation => evaluation.hardFail)) {
    return "P2-S2A REGION-FIRST HYPOTHESIS FALSIFIED ON CERTIFIED CORPUS";
  }
  const roomA = evaluations.find(evaluation => evaluation.roomId === "room-a");
  const roomE = evaluations.find(evaluation => evaluation.roomId === "room-e");
  if (
    roomA &&
    roomE &&
    roomA.usefulOnCorridorPhysicalFragmentCount > 0 &&
    roomE.usefulOnCorridorPhysicalFragmentCount > 0
  ) return "P2-S2A REGION-FIRST EXPERIMENT VIABLE";
  return "P2-S2A SAFE BUT NOT YET VIABLE";
}
