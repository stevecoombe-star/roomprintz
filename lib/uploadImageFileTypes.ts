type FileLike = {
  name?: string | null;
  type?: string | null;
};

export const HEIC_LIKE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const SUPPORTED_STILL_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  ...HEIC_LIKE_MIME_TYPES,
]);

export const HEIC_LIKE_EXTENSIONS = new Set(["heic", "heif"]);

export const SUPPORTED_STILL_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  ...HEIC_LIKE_EXTENSIONS,
]);

export const LIVE_PHOTO_MOV_MIME_TYPES = new Set([
  "video/quicktime",
  "video/mov",
  "video/x-quicktime",
]);

export const LIVE_PHOTO_MOV_EXTENSIONS = new Set(["mov"]);

export const SUPPORTED_STILL_IMAGE_ACCEPT_ATTR = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
].join(",");

function normalizeMimeType(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function normalizeFilenameExtension(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fileName = trimmed.split(/[?#]/)[0] ?? trimmed;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return null;
  const extension = fileName.slice(dotIndex + 1).trim().toLowerCase();
  return extension.length > 0 ? extension : null;
}

export function isHeicLikeMimeType(mimeType: string | null | undefined): boolean {
  return HEIC_LIKE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function isHeicLikeExtension(extension: string | null | undefined): boolean {
  return HEIC_LIKE_EXTENSIONS.has((extension ?? "").trim().toLowerCase());
}

export function isHeicLikeFile(file: FileLike | null | undefined): boolean {
  if (!file) return false;
  return (
    isHeicLikeMimeType(file.type) ||
    isHeicLikeExtension(normalizeFilenameExtension(file.name))
  );
}

export function isLivePhotoMovCompanion(file: FileLike | null | undefined): boolean {
  if (!file) return false;
  const mimeType = normalizeMimeType(file.type);
  if (LIVE_PHOTO_MOV_MIME_TYPES.has(mimeType)) return true;
  const extension = normalizeFilenameExtension(file.name);
  return extension ? LIVE_PHOTO_MOV_EXTENSIONS.has(extension) : false;
}

export function isSupportedStillImageFile(file: FileLike | null | undefined): boolean {
  if (!file) return false;
  if (isLivePhotoMovCompanion(file)) return false;
  const mimeType = normalizeMimeType(file.type);
  if (mimeType && SUPPORTED_STILL_IMAGE_MIME_TYPES.has(mimeType)) return true;
  const extension = normalizeFilenameExtension(file.name);
  return extension ? SUPPORTED_STILL_IMAGE_EXTENSIONS.has(extension) : false;
}

export function getFileExtensionFromName(fileName: string | null | undefined): string | null {
  return normalizeFilenameExtension(fileName);
}
