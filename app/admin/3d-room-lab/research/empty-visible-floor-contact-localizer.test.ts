import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2D_VISIBLE_FLOOR_CONTACT_PARAMETERS,
  VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE,
  VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION,
  type VisibleFloorContactDecodedImage,
  localizeVisibleFloorTerminationFragments,
} from "./empty-visible-floor-contact-localizer";
import {
  EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  type EmptyVisibleFloorRegion,
} from "./empty-visible-floor-region";

const WIDTH = 120;
const HEIGHT = 90;

type Rgb = readonly [number, number, number];

function regionFromMask(
  mask: Uint8Array,
  seed: Readonly<{ x: number; y: number }>,
  roomId = "room-synthetic"
): EmptyVisibleFloorRegion {
  const componentPixelCount = mask.reduce(
    (count, value) => count + (value === 0 ? 0 : 1),
    0
  );
  return {
    version: EMPTY_VISIBLE_FLOOR_REGION_VERSION,
    roomId,
    emptyImageSha256: "a".repeat(64),
    coordinateSpace: EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
    dimensions: { width: WIDTH, height: HEIGHT },
    parameters: P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
    seed: {
      pointSourcePx: seed,
      patchMeanRgb: [120, 80, 30],
      patchMeanLuma: 86,
      patchMeanWarmChroma: 90,
      effectiveMinimumWarmChroma: 10,
      effectiveMaximumLuma: 245,
      appearancePrototypes: [[120, 80, 30]],
    },
    componentMask: mask,
    componentPixelCount,
    componentFraction: componentPixelCount / mask.length,
    componentBoundsSourcePx: {
      minX: 0,
      minY: 45,
      maxX: WIDTH - 1,
      maxY: HEIGHT - 1,
    },
    boundaryPixelCount: WIDTH * 2 + (HEIGHT - 45) * 2 - 4,
    upperPerimeterSpans: [],
    frameContactSpans: [],
    diagnosticPerimeterSpans: [],
  };
}

function syntheticRegion(roomId = "room-synthetic"): EmptyVisibleFloorRegion {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 45; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  return regionFromMask(mask, { x: 60, y: 75 }, roomId);
}

function imageFromRgb(
  rgbAt: (x: number, y: number) => Rgb
): VisibleFloorContactDecodedImage {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const rgb = rgbAt(x, y);
      const offset = (y * WIDTH + x) * 3;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
    }
  }
  return { width: WIDTH, height: HEIGHT, channels: 3, pixels };
}

function syntheticImage(
  noTransitionRange?: Readonly<{ minimumX: number; maximumX: number }>
): VisibleFloorContactDecodedImage {
  return imageFromRgb((x, y) => {
    const floor = y >= 45 ||
      Boolean(
        noTransitionRange &&
        x >= noTransitionRange.minimumX &&
        x <= noTransitionRange.maximumX
      );
    return floor ? [120, 80, 30] : [220, 220, 220];
  });
}

const SYNTHETIC_PARAMETERS = Object.freeze({
  ...P2_S2D_VISIBLE_FLOOR_CONTACT_PARAMETERS,
  coreErosionRadiusPx: 4,
  contourTangentRadiusPx: 4,
  maximumSearchDistancePx: 60,
  minimumFragmentSamples: 4,
  minimumFragmentLengthPx: 8,
});

test("P2-S2D emits deterministic finite open evidence in the exact coordinate contract", () => {
  const region = syntheticRegion();
  const image = syntheticImage();
  const first = localizeVisibleFloorTerminationFragments(
    image,
    region,
    SYNTHETIC_PARAMETERS
  );
  const repeated = localizeVisibleFloorTerminationFragments(
    image,
    region,
    SYNTHETIC_PARAMETERS
  );
  assert.ok(first);
  assert.deepEqual(repeated, first);
  assert.ok(first.fragments.length > 0);
  for (const fragment of first.fragments) {
    assert.equal(fragment.coordinateSpace, VISIBLE_FLOOR_CONTACT_COORDINATE_SPACE);
    assert.equal(fragment.proposalVersion, VISIBLE_FLOOR_CONTACT_LOCALIZER_VERSION);
    assert.equal(fragment.geometryKind, "finite_open_visible_floor_termination");
    assert.ok(fragment.pointsSourceNormalized.length >= 2);
    assert.equal(fragment.startEndpoint.state, "uncertain_support_limit");
    assert.equal(fragment.endEndpoint.state, "uncertain_support_limit");
    const start = fragment.pointsSourceNormalized[0];
    const end = fragment.pointsSourceNormalized.at(-1);
    assert.ok(end);
    assert.notDeepEqual(start, end);
    assert.ok(fragment.pointsSourceNormalized.every(point =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1
    ));
    const raw = fragment as unknown as Record<string, unknown>;
    assert.equal("boundaryState" in raw, false);
    assert.equal("collisionEligible" in raw, false);
  }
});

test("P2-S2D stops at unsupported appearance gaps instead of interpolating", () => {
  const result = localizeVisibleFloorTerminationFragments(
    syntheticImage({ minimumX: 47, maximumX: 72 }),
    syntheticRegion(),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  const left = result.fragments.find(fragment =>
    fragment.pointsSourceNormalized.some(point => point.x < 0.35)
  );
  const right = result.fragments.find(fragment =>
    fragment.pointsSourceNormalized.some(point => point.x > 0.65)
  );
  assert.ok(left);
  assert.ok(right);
  assert.notEqual(left.id, right.id);
  assert.ok(result.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x * WIDTH);
    return !(Math.min(...xs) < 47 && Math.max(...xs) > 72);
  }));
});

test("P2-S2D never turns the image frame into a contact chord", () => {
  const result = localizeVisibleFloorTerminationFragments(
    syntheticImage(),
    syntheticRegion(),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.fragments.every(fragment =>
    fragment.evidence.minimumFrameDistancePx >
      SYNTHETIC_PARAMETERS.imageFrameMarginPx
  ));
  assert.ok(result.fragments.every(fragment =>
    fragment.pointsSourceNormalized.every(point =>
      point.y > 0 && point.y < 1
    )
  ));
});

test("P2-S2D trusted core stops before a thick attached non-floor blob", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 50; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  for (let y = 20; y < 50; y += 1) {
    for (let x = 35; x <= 84; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((_x, y) => y >= 50 ? [120, 80, 30] : [220, 220, 220]),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.diagnostics.appearanceContinuousPixelCount <
    result.diagnostics.rawRegionPixelCount);
  const thick = result.diagnostics.supportComponents.find(component =>
    component.maximumThicknessPx >
      SYNTHETIC_PARAMETERS.maximumReattachThicknessPx
  );
  assert.ok(thick);
  assert.equal(thick.thinComponentRestored, false);
  assert.equal(thick.remainedExcluded, true);
  const ys = result.fragments.flatMap(fragment =>
    fragment.pointsSourceNormalized.map(point => point.y * HEIGHT)
  );
  assert.ok(ys.every(y => y > 40), "selected the attached blob silhouette");
  assert.ok(ys.some(y => y >= 45 && y <= 50));
});

test("P2-S2D stripe return crosses a single strong floor stripe", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 20; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x) =>
      x === 55 ? [210, 170, 120] : [120, 80, 30]
    ),
    regionFromMask(mask, { x: 30, y: 70 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.diagnostics.stripeReturnRestoredPixelCount > 0);
  assert.ok(result.diagnostics.corePixelCount >
    result.diagnostics.appearanceContinuousPixelCount);
});

test("P2-S2D reattaches a thin exterior-connected floor remainder", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 30; y < HEIGHT; y += 1) {
    for (let x = 10; x <= 80; x += 1) mask[y * WIDTH + x] = 1;
  }
  for (let y = 45; y <= 49; y += 1) {
    for (let x = 81; x <= 110; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x, y) => {
      if (mask[y * WIDTH + x] === 0) return [235, 235, 235];
      return x > 80 ? [185, 145, 95] : [120, 80, 30];
    }),
    regionFromMask(mask, { x: 40, y: 70 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  const restored = result.diagnostics.supportComponents.find(component =>
    component.thinComponentRestored
  );
  assert.ok(restored);
  assert.equal(restored.remainedExcluded, false);
  assert.equal(
    result.diagnostics.corePixelCount,
    result.diagnostics.rawRegionPixelCount
  );
});

test("P2-S2D keeps a thick exterior-connected structure excluded", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 30; y < HEIGHT; y += 1) {
    for (let x = 10; x <= 70; x += 1) mask[y * WIDTH + x] = 1;
  }
  for (let y = 35; y <= 59; y += 1) {
    for (let x = 71; x <= 105; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x, y) => {
      if (mask[y * WIDTH + x] === 0) return [235, 235, 235];
      return x > 70 ? [210, 210, 210] : [120, 80, 30];
    }),
    regionFromMask(mask, { x: 35, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  const excluded = result.diagnostics.supportComponents.find(component =>
    component.maximumThicknessPx >
      SYNTHETIC_PARAMETERS.maximumReattachThicknessPx
  );
  assert.ok(excluded);
  assert.equal(excluded.thinComponentRestored, false);
  assert.equal(excluded.remainedExcluded, true);
});

test("P2-S2D keeps nearest valid transition ahead of a farther stronger edge", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 50; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((_x, y) => {
      if (y >= 50) return [120, 80, 30];
      return y >= 30 ? [150, 105, 50] : [240, 240, 240];
    }),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.fragments.every(fragment =>
    fragment.evidence.meanSearchDistancePx <=
      SYNTHETIC_PARAMETERS.minimumSearchDistancePx + 2
  ));
  assert.ok(result.fragments.flatMap(fragment =>
    fragment.pointsSourceNormalized
  ).every(point => point.y * HEIGHT > 40));
});

test("P2-S2D rejects fin silhouettes and keeps disconnected visible contacts", () => {
  const fins = (x: number) =>
    (x >= 45 && x <= 49) ||
    (x >= 55 && x <= 59) ||
    (x >= 65 && x <= 69);
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 50; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  for (let y = 25; y < 50; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (fins(x)) mask[y * WIDTH + x] = 1;
    }
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x, y) => {
      if (y >= 50) return [120, 80, 30];
      if (x >= 40 && x <= 80 && !fins(x)) return [120, 80, 30];
      return [220, 220, 220];
    }),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  const left = result.fragments.find(fragment =>
    fragment.pointsSourceNormalized.some(point => point.x * WIDTH < 35)
  );
  const right = result.fragments.find(fragment =>
    fragment.pointsSourceNormalized.some(point => point.x * WIDTH > 85)
  );
  assert.ok(left);
  assert.ok(right);
  assert.notEqual(left.id, right.id);
  assert.ok(result.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x * WIDTH);
    const ys = fragment.pointsSourceNormalized.map(point => point.y * HEIGHT);
    return !(Math.min(...xs) < 40 && Math.max(...xs) > 80) &&
      Math.min(...ys) > 40;
  }));
});

test("P2-S2D trusted core stays connected across a gradual lighting gradient", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 20; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x) => [90 + x, 70 + x * 0.5, 35 + x * 0.25]),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.equal(
    result.diagnostics.appearanceContinuousPixelCount,
    result.diagnostics.rawRegionPixelCount
  );
});

test("P2-S2D does not leap across a source gap to a farther wall", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 50; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x, y) => {
      if (y >= 50) return [120, 80, 30];
      if (x >= 45 && x <= 75 && y >= 20) return [120, 80, 30];
      return [220, 220, 220];
    }),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length >= 2);
  assert.ok(result.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x * WIDTH);
    return !(Math.min(...xs) < 45 && Math.max(...xs) > 75);
  }));
});

test("P2-S2D reconciliation cannot fill a true raw-mask opening", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 45; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!(x >= 48 && x <= 72 && y <= 68)) {
        mask[y * WIDTH + x] = 1;
      }
    }
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((x, y) => {
      if (mask[y * WIDTH + x] !== 0) return [120, 80, 30];
      return y < 45 && (x < 48 || x > 72)
        ? [220, 220, 220]
        : [120, 80, 30];
    }),
    regionFromMask(mask, { x: 30, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.diagnostics.corePixelCount <=
    result.diagnostics.rawRegionPixelCount);
  assert.ok(result.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x * WIDTH);
    return !(Math.min(...xs) < 48 && Math.max(...xs) > 72);
  }));
});

test("P2-S2D emits contact where trusted floor directly reaches occupied structure", () => {
  const result = localizeVisibleFloorTerminationFragments(
    syntheticImage(),
    syntheticRegion(),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.fragments.some(fragment =>
    fragment.evidence.meanOutsideRegionExclusionFraction === 1 &&
    fragment.evidence.meanTransitionRgbDistance >
      SYNTHETIC_PARAMETERS.minimumTransitionRgbDistance
  ));
});

test("P2-S2D keeps a thin floor strip trusted before a thick peninsula", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 47; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  for (let y = 20; y < 47; y += 1) {
    for (let x = 35; x <= 84; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((_x, y) => y >= 47 ? [120, 80, 30] : [220, 220, 220]),
    regionFromMask(mask, { x: 60, y: 75 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  const thick = result.diagnostics.supportComponents.find(component =>
    component.maximumThicknessPx >
      SYNTHETIC_PARAMETERS.maximumReattachThicknessPx
  );
  assert.ok(thick);
  assert.equal(thick.remainedExcluded, true);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.fragments.flatMap(fragment =>
    fragment.pointsSourceNormalized
  ).every(point => point.y * HEIGHT > 40));
});

test("P2-S2D low-occupancy normal points outward for opposite occupancy", () => {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < 45; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) mask[y * WIDTH + x] = 1;
  }
  const result = localizeVisibleFloorTerminationFragments(
    imageFromRgb((_x, y) => y < 45 ? [120, 80, 30] : [220, 220, 220]),
    regionFromMask(mask, { x: 60, y: 30 }),
    SYNTHETIC_PARAMETERS
  );
  assert.ok(result);
  assert.ok(result.fragments.length > 0);
  assert.ok(result.fragments.some(fragment =>
    fragment.evidence.meanOutwardNormal.y > 0.9
  ));
});

test("P2-S2D detector source has no room conditions, oracle input, or forbidden authority fields", async () => {
  const source = await readFile(path.join(
    process.cwd(),
    "app",
    "admin",
    "3d-room-lab",
    "research",
    "empty-visible-floor-contact-localizer.ts"
  ), "utf8");
  assert.doesNotMatch(source, /room-[abcde]/);
  assert.doesNotMatch(
    source,
    /P2-S1A|oracle|world-XZ|worldXZ|camera|TILED|product|compositor|collisionEligible|boundaryState/
  );
  assert.doesNotMatch(source, /\b(?:closePath|polygon|convexHull)\b/);
  assert.match(source, /first_supported_outward_appearance_transition/);
});
