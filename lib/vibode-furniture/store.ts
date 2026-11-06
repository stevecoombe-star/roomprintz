import type { PersonalFurnitureAssetRecord, PersonalFurnitureUploadRecord } from "./library";

export type PersonalFurnitureStore = Readonly<{
  countOpenUploads: (userId: string, nowIso: string) => Promise<number>;
  /**
   * Expires this user's abandoned uploads and returns their pending object paths.
   * A finalizing upload with a fresh lease is left alone.
   */
  expireUploads: (userId: string, nowIso: string) => Promise<readonly string[]>;
  insertUpload: (upload: PersonalFurnitureUploadRecord) => Promise<void>;
  readUpload: (
    userId: string,
    uploadId: string,
  ) => Promise<PersonalFurnitureUploadRecord | null>;
  claimUpload: (
    userId: string,
    uploadId: string,
    nowIso: string,
  ) => Promise<PersonalFurnitureUploadRecord | "lost" | null>;
  markUploadFinalized: (userId: string, uploadId: string, resultAssetId: string) => Promise<void>;
  markUploadRejected: (userId: string, uploadId: string) => Promise<void>;
  findAssetBySha: (userId: string, sha256: string) => Promise<PersonalFurnitureAssetRecord | null>;
  findOwnedAsset: (userId: string, assetId: string) => Promise<PersonalFurnitureAssetRecord | null>;
  insertAsset: (asset: PersonalFurnitureAssetRecord) => Promise<"inserted" | "exists">;
  listActive: (userId: string) => Promise<readonly PersonalFurnitureAssetRecord[]>;
  archiveAsset: (userId: string, assetId: string) => Promise<"archived" | "missing">;
  ownedAssetIds: (userId: string, assetIds: readonly string[]) => Promise<ReadonlySet<string>>;
}>;

export type PersonalObjectStore = Readonly<{
  createPendingUploadUrl: (objectPath: string) => Promise<{ signedUrl: string } | null>;
  read: (objectPath: string) => Promise<Uint8Array | null>;
  writePermanent: (
    objectPath: string,
    bytes: Uint8Array,
  ) => Promise<"written" | "exists" | "failed">;
  remove: (objectPath: string) => Promise<void>;
  signGet: (
    objectPath: string,
  ) => Promise<{ signedUrl: string; expiresAt: string } | null>;
}>;

export type PersonalGlbValidation = Readonly<{
  accepted: boolean;
  sha256: string;
  byteSize: number;
  widthM: number | null;
  heightM: number | null;
  depthM: number | null;
  errors: readonly { code: string; message: string }[];
}>;

export type PersonalGlbValidator = (
  input: Readonly<{ bytes: Uint8Array; assetId: string }>,
) => Promise<PersonalGlbValidation>;
