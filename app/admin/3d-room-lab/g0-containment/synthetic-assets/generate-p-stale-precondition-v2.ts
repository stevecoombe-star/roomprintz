import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  applyHomography,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  solvePlaneHomography,
  type HomographyMatrix,
  type Vec2,
} from "@/app/admin/3d-room-lab/perspective-solve";
import {
  assertDerivedPStalePreconditionV2CornersMatchSpec,
  derivePStalePreconditionV2SourceCorners,
  P_STALE_PRECONDITION_V2_ASSET_ID,
  P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_DECLARED_CORNERS,
  P_STALE_PRECONDITION_V2_FILE_NAME,
  P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS,
  P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX,
  P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_SOURCE_SIZE,
  P_STALE_PRECONDITION_V2_TEXT,
} from "../p-stale-precondition-v2-spec";

type Rgb = readonly [number, number, number];

const BACKGROUND_COLOR: Rgb = [12, 16, 22];
const FLOOR_BASE_COLOR: Rgb = [178, 182, 188];
const FLOOR_ALT_COLOR: Rgb = [158, 163, 171];
const GRID_COLOR: Rgb = [62, 70, 82];
const BOUNDARY_COLOR: Rgb = [246, 248, 252];
const MARKER_DARK: Rgb = [0, 0, 0];
const MARKER_LIGHT: Rgb = [255, 255, 255];
const MARKER_X_COLOR: Rgb = [210, 32, 32];
const TEXT_COLOR: Rgb = [250, 252, 255];

function setPixel(buffer: Uint8Array, width: number, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 3;
  if (index < 0 || index + 2 >= buffer.length) return;
  buffer[index] = color[0];
  buffer[index + 1] = color[1];
  buffer[index + 2] = color[2];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped),
  ];
}

function distanceToNearestInteger(value: number): number {
  return Math.abs(value - Math.round(value));
}

function drawFloor(buffer: Uint8Array, width: number, height: number, sourceToFloorHomography: HomographyMatrix): void {
  const halfWidthMeters = P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS.widthMeters / 2;
  const halfDepthMeters = P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS.depthMeters / 2;
  const boundaryThicknessMeters = 0.05;
  const gridThicknessMeters = 0.015;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mapped = applyHomography(sourceToFloorHomography, { x: x + 0.5, y: y + 0.5 });
      if (!mapped) {
        setPixel(buffer, width, x, y, BACKGROUND_COLOR);
        continue;
      }

      const inside =
        mapped.x >= -halfWidthMeters &&
        mapped.x <= halfWidthMeters &&
        mapped.y >= -halfDepthMeters &&
        mapped.y <= halfDepthMeters;
      if (!inside) {
        setPixel(buffer, width, x, y, BACKGROUND_COLOR);
        continue;
      }

      const checkerX = Math.floor((mapped.x + halfWidthMeters) * 2);
      const checkerY = Math.floor((mapped.y + halfDepthMeters) * 2);
      const checker = (checkerX + checkerY) % 2 === 0 ? FLOOR_BASE_COLOR : FLOOR_ALT_COLOR;

      const depthT = (mapped.y + halfDepthMeters) / P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS.depthMeters;
      let color = mix(checker, [205, 210, 216], depthT * 0.22);

      const gridHit =
        distanceToNearestInteger(mapped.x + halfWidthMeters) <= gridThicknessMeters ||
        distanceToNearestInteger(mapped.y + halfDepthMeters) <= gridThicknessMeters;
      if (gridHit) {
        color = GRID_COLOR;
      }

      const boundaryDistance = Math.min(
        Math.abs(mapped.x + halfWidthMeters),
        Math.abs(mapped.x - halfWidthMeters),
        Math.abs(mapped.y + halfDepthMeters),
        Math.abs(mapped.y - halfDepthMeters)
      );
      if (boundaryDistance <= boundaryThicknessMeters) {
        color = BOUNDARY_COLOR;
      }

      setPixel(buffer, width, x, y, color);
    }
  }
}

function drawLine(buffer: Uint8Array, width: number, height: number, from: Vec2, to: Vec2, color: Rgb): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps < 1) return;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      setPixel(buffer, width, x, y, color);
    }
  }
}

function drawCheckerboardXMarker(
  buffer: Uint8Array,
  width: number,
  height: number,
  center: Vec2,
  markerSizePx: number
): void {
  const half = markerSizePx / 2;
  const left = Math.round(center.x - half);
  const top = Math.round(center.y - half);
  const right = Math.round(center.x + half);
  const bottom = Math.round(center.y + half);
  const centerX = center.x;
  const centerY = center.y;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const inBounds = x >= 0 && x < width && y >= 0 && y < height;
      if (!inBounds) continue;
      const quadrantLeft = x < centerX;
      const quadrantTop = y < centerY;
      const isLight = quadrantLeft === quadrantTop;
      setPixel(buffer, width, x, y, isLight ? MARKER_LIGHT : MARKER_DARK);
    }
  }

  const markerRadius = markerSizePx * 0.5;
  drawLine(
    buffer,
    width,
    height,
    { x: center.x - markerRadius, y: center.y - markerRadius },
    { x: center.x + markerRadius, y: center.y + markerRadius },
    MARKER_X_COLOR
  );
  drawLine(
    buffer,
    width,
    height,
    { x: center.x - markerRadius, y: center.y + markerRadius },
    { x: center.x + markerRadius, y: center.y - markerRadius },
    MARKER_X_COLOR
  );
}

const FONT_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawTextLine(
  buffer: Uint8Array,
  width: number,
  height: number,
  text: string,
  originX: number,
  originY: number,
  pixelScale: number
): void {
  let cursorX = originX;
  for (const char of text) {
    const glyph = FONT_5X7[char] ?? FONT_5X7[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        for (let sy = 0; sy < pixelScale; sy += 1) {
          for (let sx = 0; sx < pixelScale; sx += 1) {
            const x = cursorX + col * pixelScale + sx;
            const y = originY + row * pixelScale + sy;
            if (x >= 0 && x < width && y >= 0 && y < height) {
              setPixel(buffer, width, x, y, TEXT_COLOR);
            }
          }
        }
      }
    }
    cursorX += 6 * pixelScale;
  }
}

async function generateImageBuffer(): Promise<Buffer> {
  const { width, height } = P_STALE_PRECONDITION_V2_SOURCE_SIZE;
  const imageBuffer = new Uint8Array(width * height * 3);

  const derivedCorners = derivePStalePreconditionV2SourceCorners();
  assertDerivedPStalePreconditionV2CornersMatchSpec(derivedCorners);

  const floorRect = getFloorRectCorners(P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS);
  if (!floorRect.ok) {
    throw new Error(`Failed to build floor rectangle for ${P_STALE_PRECONDITION_V2_ASSET_ID}: ${floorRect.reason}`);
  }

  const sourcePoints = [derivedCorners.NL, derivedCorners.NR, derivedCorners.FR, derivedCorners.FL];
  const floorPoints = floorRect.value.asArray.map((point) => floorVec3ToPlane2D(point));
  const imageToFloor = solvePlaneHomography(sourcePoints, floorPoints);
  if (!imageToFloor.ok) {
    throw new Error(`Failed to solve source->floor homography for ${P_STALE_PRECONDITION_V2_ASSET_ID}: ${imageToFloor.reason}`);
  }

  drawFloor(imageBuffer, width, height, imageToFloor.value);

  for (const key of ["NL", "NR", "FR", "FL"] as const) {
    drawCheckerboardXMarker(
      imageBuffer,
      width,
      height,
      P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key].px,
      P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX
    );
  }

  drawTextLine(
    imageBuffer,
    width,
    height,
    P_STALE_PRECONDITION_V2_TEXT.toUpperCase(),
    58,
    40,
    3
  );

  return sharp(Buffer.from(imageBuffer), {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: false })
    .withMetadata({ orientation: 1 })
    .toBuffer();
}

async function writeOutputs(bytes: Buffer): Promise<void> {
  const canonicalPath = path.join(process.cwd(), P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH);
  const mirrorPath = path.join(process.cwd(), P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH);
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await mkdir(path.dirname(mirrorPath), { recursive: true });
  await writeFile(canonicalPath, bytes);
  await writeFile(mirrorPath, bytes);
}

async function main(): Promise<void> {
  const shouldWrite = process.argv.includes("--write");
  const bytes = await generateImageBuffer();
  if (shouldWrite) {
    await writeOutputs(bytes);
    process.stdout.write(
      `Generated ${P_STALE_PRECONDITION_V2_FILE_NAME} and wrote canonical + public mirror outputs.\n`
    );
    return;
  }
  process.stdout.write(
    `Generated ${P_STALE_PRECONDITION_V2_FILE_NAME} in-memory (${bytes.byteLength} bytes). Re-run with --write to persist.\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

