import { createHash } from "node:crypto";

import sharp from "sharp";

export const EMPTY_VISIBLE_FLOOR_REGION_VERSION = "p2-s2a-visible-floor-region/v1" as const;
export const EMPTY_SOURCE_PIXEL_COORDINATE_SPACE = "empty-source-pixels/v1" as const;

export type SourcePixelPoint = Readonly<{ x: number; y: number }>;
export type Rgb = readonly [number, number, number];
export type CertifiedEmptyVisibleFloorSourceIdentity = Readonly<{
  roomId: string;
  emptyImage: Readonly<{
    sha256: string;
    dimensions: Readonly<{ width: number; height: number }>;
  }>;
}>;

export type EmptyVisibleFloorRegionParameters = Readonly<{
  blurSigma: number;
  roiYMinNormalized: number;
  seedXMinNormalized: number;
  seedXMaxNormalized: number;
  seedYMinNormalized: number;
  seedYMaxNormalized: number;
  seedModelYMinNormalized: number;
  seedModelYMaxNormalized: number;
  seedModelStridePx: number;
  minimumWarmChroma: number;
  seedWarmChromaFraction: number;
  maximumLuma: number;
  seedLumaHeadroom: number;
  maximumAdjacentUpperPerimeterJumpPx: number;
}>;

/**
 * Global A/C/E research parameters. The lower-center patch adapts the minimum
 * warm-chroma and maximum-luma gates, but no value or branch is room-specific.
 * The mask is only a diagnostic proposal and has no wall/collision semantics.
 */
export const P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS: EmptyVisibleFloorRegionParameters =
  Object.freeze({
    blurSigma: 2,
    roiYMinNormalized: 0.5,
    seedXMinNormalized: 0.45,
    seedXMaxNormalized: 0.55,
    seedYMinNormalized: 0.88,
    seedYMaxNormalized: 0.94,
    seedModelYMinNormalized: 0.82,
    seedModelYMaxNormalized: 0.95,
    seedModelStridePx: 4,
    minimumWarmChroma: 10,
    seedWarmChromaFraction: 0.25,
    maximumLuma: 245,
    seedLumaHeadroom: 160,
    maximumAdjacentUpperPerimeterJumpPx: 3,
  });

export type DiagnosticPerimeterSpan = Readonly<{
  id: string;
  kind: "upper_component_perimeter" | "image_frame_contact";
  frameSide: "top" | "right" | "bottom" | "left" | null;
  touchesImageFrame: boolean;
  pointsSourcePx: readonly SourcePixelPoint[];
}>;

export type EmptyVisibleFloorRegion = Readonly<{
  version: typeof EMPTY_VISIBLE_FLOOR_REGION_VERSION;
  roomId: string;
  emptyImageSha256: string;
  coordinateSpace: typeof EMPTY_SOURCE_PIXEL_COORDINATE_SPACE;
  dimensions: Readonly<{ width: number; height: number }>;
  parameters: EmptyVisibleFloorRegionParameters;
  seed: Readonly<{
    pointSourcePx: SourcePixelPoint;
    patchMeanRgb: Rgb;
    patchMeanLuma: number;
    patchMeanWarmChroma: number;
    effectiveMinimumWarmChroma: number;
    effectiveMaximumLuma: number;
    appearancePrototypes: readonly Rgb[];
  }>;
  componentMask: Uint8Array;
  componentPixelCount: number;
  componentFraction: number;
  componentBoundsSourcePx: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  boundaryPixelCount: number;
  upperPerimeterSpans: readonly DiagnosticPerimeterSpan[];
  frameContactSpans: readonly DiagnosticPerimeterSpan[];
  diagnosticPerimeterSpans: readonly DiagnosticPerimeterSpan[];
}>;

export type EmptyVisibleFloorRegionReadResult =
  | Readonly<{
      ok: true;
      observedIdentity: Readonly<{
        sha256: string;
        dimensions: Readonly<{ width: number; height: number }>;
      }>;
      region: EmptyVisibleFloorRegion;
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

function luma(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function warmChroma(rgb: Rgb): number {
  return rgb[0] - rgb[2];
}

function pixelRgb(image: DecodedRgb, x: number, y: number): Rgb {
  const offset = (y * image.width + x) * image.channels;
  return [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
  ];
}

function integerRange(
  normalizedMinimum: number,
  normalizedMaximum: number,
  length: number
): readonly [number, number] {
  return [
    Math.max(0, Math.min(length - 1, Math.floor(normalizedMinimum * length))),
    Math.max(0, Math.min(length - 1, Math.floor(normalizedMaximum * length))),
  ];
}

function patchMean(
  image: DecodedRgb,
  xMinimum: number,
  xMaximum: number,
  yMinimum: number,
  yMaximum: number
): Rgb {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = yMinimum; y <= yMaximum; y += 1) {
    for (let x = xMinimum; x <= xMaximum; x += 1) {
      const rgb = pixelRgb(image, x, y);
      red += rgb[0];
      green += rgb[1];
      blue += rgb[2];
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

function seedAppearancePrototypes(
  image: DecodedRgb,
  parameters: EmptyVisibleFloorRegionParameters
): readonly Rgb[] {
  const [xMinimum, xMaximum] = integerRange(
    parameters.seedXMinNormalized,
    parameters.seedXMaxNormalized,
    image.width
  );
  const [yMinimum, yMaximum] = integerRange(
    parameters.seedModelYMinNormalized,
    parameters.seedModelYMaxNormalized,
    image.height
  );
  const prototypes: Rgb[] = [];
  for (let y = yMinimum; y <= yMaximum; y += parameters.seedModelStridePx) {
    for (let x = xMinimum; x <= xMaximum; x += parameters.seedModelStridePx) {
      prototypes.push(Object.freeze(pixelRgb(image, x, y)) as Rgb);
    }
  }
  return Object.freeze(prototypes);
}

function selectSeedPoint(
  qualified: Uint8Array,
  width: number,
  height: number,
  parameters: EmptyVisibleFloorRegionParameters
): SourcePixelPoint | null {
  const [xMinimum, xMaximum] = integerRange(
    parameters.seedXMinNormalized,
    parameters.seedXMaxNormalized,
    width
  );
  const [yMinimum, yMaximum] = integerRange(
    parameters.seedYMinNormalized,
    parameters.seedYMaxNormalized,
    height
  );
  const centerX = (xMinimum + xMaximum) / 2;
  const centerY = (yMinimum + yMaximum) / 2;
  let selected: SourcePixelPoint | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let y = yMinimum; y <= yMaximum; y += 1) {
    for (let x = xMinimum; x <= xMaximum; x += 1) {
      if (qualified[y * width + x] === 0) continue;
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distance < selectedDistance) {
        selected = Object.freeze({ x, y });
        selectedDistance = distance;
      }
    }
  }
  return selected;
}

function componentContainingSeed(
  qualified: Uint8Array,
  width: number,
  height: number,
  seed: SourcePixelPoint
): Readonly<{ mask: Uint8Array; count: number }> {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const seedIndex = seed.y * width + seed.x;
  let readIndex = 0;
  let writeIndex = 0;
  queue[writeIndex] = seedIndex;
  writeIndex += 1;
  mask[seedIndex] = 1;

  while (readIndex < writeIndex) {
    const index = queue[readIndex];
    readIndex += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (
        neighbor >= 0 &&
        qualified[neighbor] !== 0 &&
        mask[neighbor] === 0
      ) {
        mask[neighbor] = 1;
        queue[writeIndex] = neighbor;
        writeIndex += 1;
      }
    }
  }
  return Object.freeze({ mask, count: writeIndex });
}

function upperPerimeterSpans(
  mask: Uint8Array,
  width: number,
  height: number,
  maximumJumpPx: number,
  roomId: string
): readonly DiagnosticPerimeterSpan[] {
  const topByColumn: (SourcePixelPoint | null)[] = [];
  for (let x = 0; x < width; x += 1) {
    let point: SourcePixelPoint | null = null;
    for (let y = 0; y < height; y += 1) {
      if (mask[y * width + x] !== 0) {
        point = Object.freeze({ x, y });
        break;
      }
    }
    topByColumn.push(point);
  }

  const runs: SourcePixelPoint[][] = [];
  let current: SourcePixelPoint[] = [];
  const finish = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const point of topByColumn) {
    const previous = current.at(-1);
    if (
      !point ||
      (previous &&
        (point.x !== previous.x + 1 ||
          Math.abs(point.y - previous.y) > maximumJumpPx))
    ) {
      finish();
    }
    if (point) current.push(point);
  }
  finish();

  return Object.freeze(runs.map((points, index) =>
    Object.freeze({
      id: `${EMPTY_VISIBLE_FLOOR_REGION_VERSION}:${roomId}:upper:${String(index).padStart(4, "0")}`,
      kind: "upper_component_perimeter" as const,
      frameSide: null,
      touchesImageFrame: points.some(point =>
        point.x === 0 ||
        point.y === 0 ||
        point.x === width - 1 ||
        point.y === height - 1
      ),
      pointsSourcePx: Object.freeze(points),
    })
  ));
}

function frameContactSpans(
  mask: Uint8Array,
  width: number,
  height: number,
  roomId: string
): readonly DiagnosticPerimeterSpan[] {
  const sides = [
    {
      name: "top" as const,
      length: width,
      point: (offset: number) => ({ x: offset, y: 0 }),
    },
    {
      name: "right" as const,
      length: height,
      point: (offset: number) => ({ x: width - 1, y: offset }),
    },
    {
      name: "bottom" as const,
      length: width,
      point: (offset: number) => ({ x: offset, y: height - 1 }),
    },
    {
      name: "left" as const,
      length: height,
      point: (offset: number) => ({ x: 0, y: offset }),
    },
  ];
  const spans: DiagnosticPerimeterSpan[] = [];
  for (const side of sides) {
    let start: number | null = null;
    const finish = (end: number) => {
      if (start === null) return;
      const startPoint = Object.freeze(side.point(start));
      const endPoint = Object.freeze(side.point(end));
      spans.push(Object.freeze({
        id: `${EMPTY_VISIBLE_FLOOR_REGION_VERSION}:${roomId}:frame:${side.name}:${String(spans.length).padStart(4, "0")}`,
        kind: "image_frame_contact",
        frameSide: side.name,
        touchesImageFrame: true,
        pointsSourcePx: Object.freeze(
          start === end ? [startPoint] : [startPoint, endPoint]
        ),
      }));
      start = null;
    };
    for (let offset = 0; offset < side.length; offset += 1) {
      const point = side.point(offset);
      const present = mask[point.y * width + point.x] !== 0;
      if (present && start === null) start = offset;
      if (!present && start !== null) finish(offset - 1);
    }
    if (start !== null) finish(side.length - 1);
  }
  return Object.freeze(spans);
}

function componentDiagnostics(
  mask: Uint8Array,
  width: number,
  height: number
): Readonly<{
  bounds: EmptyVisibleFloorRegion["componentBoundsSourcePx"];
  boundaryPixelCount: number;
}> {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let boundaryPixelCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        mask[index - 1] === 0 ||
        mask[index + 1] === 0 ||
        mask[index - width] === 0 ||
        mask[index + width] === 0
      ) boundaryPixelCount += 1;
    }
  }
  return Object.freeze({
    bounds: Object.freeze({ minX, minY, maxX, maxY }),
    boundaryPixelCount,
  });
}

/**
 * Certified bytes -> blurred appearance gate -> four-connected component
 * containing one deterministic lower-center seed. The fixture is used only
 * for exact identity binding; annotation coordinates are never read.
 */
export async function readCertifiedEmptyVisibleFloorRegion(
  imageBytes: Uint8Array,
  sourceIdentity: CertifiedEmptyVisibleFloorSourceIdentity,
  parameters: EmptyVisibleFloorRegionParameters =
    P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS
): Promise<EmptyVisibleFloorRegionReadResult> {
  try {
    const decoded = await sharp(imageBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const blurred = await sharp(imageBytes)
      .removeAlpha()
      .blur(parameters.blurSigma)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sha256 = createHash("sha256").update(imageBytes).digest("hex");
    const observedIdentity = Object.freeze({
      sha256,
      dimensions: Object.freeze({
        width: decoded.info.width,
        height: decoded.info.height,
      }),
    });
    if (
      decoded.info.channels < 3 ||
      blurred.info.channels < 3 ||
      sourceIdentity.emptyImage.sha256 !== observedIdentity.sha256 ||
      sourceIdentity.emptyImage.dimensions.width !==
        observedIdentity.dimensions.width ||
      sourceIdentity.emptyImage.dimensions.height !==
        observedIdentity.dimensions.height
    ) {
      return { ok: false, reason: "fixture_identity_mismatch" };
    }

    const image: DecodedRgb = Object.freeze({
      width: blurred.info.width,
      height: blurred.info.height,
      channels: blurred.info.channels,
      pixels: blurred.data,
    });
    const [seedXMinimum, seedXMaximum] = integerRange(
      parameters.seedXMinNormalized,
      parameters.seedXMaxNormalized,
      image.width
    );
    const [seedYMinimum, seedYMaximum] = integerRange(
      parameters.seedYMinNormalized,
      parameters.seedYMaxNormalized,
      image.height
    );
    const patchMeanRgb = patchMean(
      image,
      seedXMinimum,
      seedXMaximum,
      seedYMinimum,
      seedYMaximum
    );
    const patchMeanLuma = luma(patchMeanRgb);
    const patchMeanWarmChroma = warmChroma(patchMeanRgb);
    const effectiveMinimumWarmChroma = Math.max(
      parameters.minimumWarmChroma,
      patchMeanWarmChroma * parameters.seedWarmChromaFraction
    );
    const effectiveMaximumLuma = Math.min(
      parameters.maximumLuma,
      patchMeanLuma + parameters.seedLumaHeadroom
    );
    const qualified = new Uint8Array(image.width * image.height);
    const yMinimum = Math.floor(parameters.roiYMinNormalized * image.height);
    for (let y = yMinimum; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const rgb = pixelRgb(image, x, y);
        if (
          warmChroma(rgb) >= effectiveMinimumWarmChroma &&
          luma(rgb) <= effectiveMaximumLuma
        ) qualified[y * image.width + x] = 1;
      }
    }

    const seed = selectSeedPoint(
      qualified,
      image.width,
      image.height,
      parameters
    );
    if (!seed) {
      return { ok: false, reason: "lower_center_seed_not_floor_like" };
    }
    const component = componentContainingSeed(
      qualified,
      image.width,
      image.height,
      seed
    );
    if (component.count === 0) {
      return { ok: false, reason: "empty_seed_component" };
    }
    const upper = upperPerimeterSpans(
      component.mask,
      image.width,
      image.height,
      parameters.maximumAdjacentUpperPerimeterJumpPx,
      sourceIdentity.roomId
    );
    const frame = frameContactSpans(
      component.mask,
      image.width,
      image.height,
      sourceIdentity.roomId
    );
    const diagnostics = componentDiagnostics(
      component.mask,
      image.width,
      image.height
    );
    const region: EmptyVisibleFloorRegion = Object.freeze({
      version: EMPTY_VISIBLE_FLOOR_REGION_VERSION,
      roomId: sourceIdentity.roomId,
      emptyImageSha256: sha256,
      coordinateSpace: EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
      dimensions: observedIdentity.dimensions,
      parameters,
      seed: Object.freeze({
        pointSourcePx: seed,
        patchMeanRgb: Object.freeze(patchMeanRgb) as Rgb,
        patchMeanLuma,
        patchMeanWarmChroma,
        effectiveMinimumWarmChroma,
        effectiveMaximumLuma,
        appearancePrototypes: seedAppearancePrototypes(image, parameters),
      }),
      componentMask: component.mask,
      componentPixelCount: component.count,
      componentFraction:
        component.count / (image.width * image.height),
      componentBoundsSourcePx: diagnostics.bounds,
      boundaryPixelCount: diagnostics.boundaryPixelCount,
      upperPerimeterSpans: upper,
      frameContactSpans: frame,
      diagnosticPerimeterSpans: Object.freeze([...upper, ...frame]),
    });
    return Object.freeze({ ok: true, observedIdentity, region });
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
}
