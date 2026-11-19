/**
 * Byte-level still-image identification shared by room upload checks and
 * the 3D Generator. File names and browser MIME types are not trusted once
 * the header is available.
 */

export type StillMagic = "jpeg" | "png" | "webp" | "heic" | "avif" | "gif" | "mov" | "unknown";

export type JpegInspection = Readonly<{
  widthPx: number;
  heightPx: number;
  displayedWidthPx: number;
  displayedHeightPx: number;
  components: number;
  /** 1 when the file has no EXIF orientation tag. */
  orientation: number;
}>;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "heif",
  "mif1",
  "msf1",
]);

const AVIF_BRANDS = new Set(["avif", "avis"]);

const MOV_BRANDS = new Set(["qt  ", "mqt "]);

export function detectStillMagic(bytes: Uint8Array): StillMagic {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "webp";
  const brand = fileTypeBrand(bytes);
  if (!brand) return "unknown";
  if (HEIC_BRANDS.has(brand.major) || brand.compatible.some((value) => HEIC_BRANDS.has(value))) return "heic";
  if (AVIF_BRANDS.has(brand.major) || brand.compatible.some((value) => AVIF_BRANDS.has(value))) return "avif";
  if (MOV_BRANDS.has(brand.major) || brand.compatible.some((value) => MOV_BRANDS.has(value))) return "mov";
  return "unknown";
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection | null {
  if (detectStillMagic(bytes) !== "jpeg" || bytes.length < 4) return null;
  let offset = 2;
  let widthPx = 0;
  let heightPx = 0;
  let components = 0;
  let sawFrame = false;
  let orientation = 1;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) break;
    const data = offset + 2;
    const dataLength = length - 2;
    if (marker === 0xe1) {
      const read = readExifOrientation(bytes, data, dataLength);
      if (read) orientation = read;
    }
    if (isStartOfFrame(marker) && dataLength >= 6) {
      heightPx = ((bytes[data + 1] ?? 0) << 8) | (bytes[data + 2] ?? 0);
      widthPx = ((bytes[data + 3] ?? 0) << 8) | (bytes[data + 4] ?? 0);
      components = bytes[data + 5] ?? 0;
      sawFrame = widthPx > 0 && heightPx > 0 && components > 0;
    }
    if (marker === 0xda) break;
    offset += length;
  }
  if (!sawFrame) return null;
  const rotated = orientation >= 5 && orientation <= 8;
  return {
    widthPx,
    heightPx,
    components,
    orientation,
    displayedWidthPx: rotated ? heightPx : widthPx,
    displayedHeightPx: rotated ? widthPx : heightPx,
  };
}

export function jpegCanPassThrough(
  jpeg: JpegInspection,
  byteLength: number,
  limits: Readonly<{ maxBytes: number; maxEdgePx: number; minEdgePx: number }>,
): boolean {
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > limits.maxBytes) return false;
  if (jpeg.orientation !== 1 || jpeg.components !== 3) return false;
  if (jpeg.displayedWidthPx < limits.minEdgePx || jpeg.displayedHeightPx < limits.minEdgePx) return false;
  const longest = Math.max(jpeg.displayedWidthPx, jpeg.displayedHeightPx);
  return longest <= limits.maxEdgePx;
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
  );
}

function fileTypeBrand(bytes: Uint8Array): { major: string; compatible: string[] } | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  const major = ascii(bytes, 8, 4);
  const boxSize = readU32(bytes, 0);
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : Math.min(bytes.length, 64));
  const compatible: string[] = [];
  for (let offset = 16; offset + 4 <= end; offset += 4) compatible.push(ascii(bytes, offset, 4));
  return { major, compatible };
}

function readExifOrientation(bytes: Uint8Array, start: number, length: number): number | null {
  if (length < 14) return null;
  if (ascii(bytes, start, 4) !== "Exif" || bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return null;
  const tiff = start + 6;
  const end = start + length;
  if (tiff + 8 > end) return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const read16 = (offset: number): number | null => {
    if (offset < 0 || offset + 2 > end) return null;
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    return little ? first | (second << 8) : (first << 8) | second;
  };
  const read32 = (offset: number): number | null => {
    if (offset < 0 || offset + 4 > end) return null;
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const fourth = bytes[offset + 3] ?? 0;
    return little
      ? (first | (second << 8) | (third << 16) | (fourth << 24)) >>> 0
      : ((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0;
  };
  if (read16(tiff + 2) !== 42) return null;
  const ifdOffset = read32(tiff + 4);
  if (ifdOffset == null) return null;
  const ifd = tiff + ifdOffset;
  const count = read16(ifd);
  if (count == null || count > 256) return null;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (read16(entry) !== 0x0112) continue;
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) return null;
    const value = read16(entry + 8);
    return value != null && value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24)
    | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8)
    | (bytes[offset + 3] ?? 0)
  ) >>> 0;
}
