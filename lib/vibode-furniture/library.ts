import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

import {
  isPersonalFurnitureAssetId,
  PERSONAL_FURNITURE_CATEGORY_MAX,
  PERSONAL_FURNITURE_NAME_MAX,
} from "./asset-id";

export type PersonalFurnitureVisibility = "active" | "archived";

export type PersonalFurnitureAssetRecord = Readonly<{
  assetId: string;
  userId: string;
  displayName: string;
  category: string | null;
  origin: "uploaded";
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  sha256: string;
  byteSize: number;
  storageBucket: string;
  storageObjectPath: string;
  libraryVisibility: PersonalFurnitureVisibility;
}>;

export type PersonalFurnitureLibraryItem = Readonly<{
  assetId: string;
  displayName: string;
  category: string | null;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  previewUrl: string | null;
}>;

export type PersonalUploadStatus =
  | "pending"
  | "finalizing"
  | "finalized"
  | "rejected"
  | "expired";

export type PersonalFurnitureUploadRecord = Readonly<{
  uploadId: string;
  userId: string;
  assetId: string;
  storageBucket: string;
  pendingObjectPath: string;
  permanentObjectPath: string;
  status: PersonalUploadStatus;
  resultAssetId: string | null;
  expiresAt: string;
  updatedAt: string;
}>;

export function normalizePersonalDisplayName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > PERSONAL_FURNITURE_NAME_MAX) return null;
  return name;
}

export function normalizePersonalCategory(value: string | null | undefined): string | null | "invalid" {
  if (value == null) return null;
  const category = value.replace(/\s+/g, " ").trim();
  if (!category) return null;
  if (category.length > PERSONAL_FURNITURE_CATEGORY_MAX) return "invalid";
  return category;
}

export function personalFurnitureAssetIds(
  objects: readonly SceneObjectDefinition[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!isPersonalFurnitureAssetId(object.assetId) || seen.has(object.assetId)) continue;
    seen.add(object.assetId);
    ids.push(object.assetId);
  }
  return ids;
}

export function toPersonalLibraryItem(
  asset: PersonalFurnitureAssetRecord,
  previewUrl: string | null,
): PersonalFurnitureLibraryItem {
  return {
    assetId: asset.assetId,
    displayName: asset.displayName,
    category: asset.category,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
    previewUrl,
  };
}

export function personalLibraryItemLeaksStorage(item: PersonalFurnitureLibraryItem): boolean {
  const json = JSON.stringify(item);
  return (
    json.includes("storageObjectPath") ||
    json.includes("storageBucket") ||
    json.includes("sha256") ||
    json.includes("service_role")
  );
}
