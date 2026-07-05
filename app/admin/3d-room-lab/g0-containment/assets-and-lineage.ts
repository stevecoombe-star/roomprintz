import path from "node:path";

export type G0SyntheticAssetId =
  | "A-parent"
  | "A-exif"
  | "A-crop"
  | "A-empty"
  | "A-gen"
  | "A-drift-b"
  | "P-stale-precondition";

export type G0SyntheticAsset = {
  readonly assetId: G0SyntheticAssetId;
  readonly fileName: string;
  readonly sha256: string;
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly encodedOrientation: number;
  readonly parentAssetId: G0SyntheticAssetId | null;
};

export const G0_SYNTHETIC_ASSET_BASE_DIR = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/synthetic-assets"
);

export const G0_SYNTHETIC_ASSETS: Record<G0SyntheticAssetId, G0SyntheticAsset> = {
  "A-parent": {
    assetId: "A-parent",
    fileName: "A-parent.jpg",
    sha256: "bd7ffe9c5e68fd5fce30faf94cafe57f5e0840ed74a03986f74d2526fc95e9c8",
    decodedWidth: 320,
    decodedHeight: 240,
    encodedOrientation: 1,
    parentAssetId: null,
  },
  "A-exif": {
    assetId: "A-exif",
    fileName: "A-exif.jpg",
    sha256: "26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859",
    decodedWidth: 320,
    decodedHeight: 240,
    encodedOrientation: 6,
    parentAssetId: "A-parent",
  },
  "A-crop": {
    assetId: "A-crop",
    fileName: "A-crop.jpg",
    sha256: "4aa5b69c28d49aef2847936fef9fe91a70be48b7e7f99f6f8063f37f7f4b60f2",
    decodedWidth: 280,
    decodedHeight: 220,
    encodedOrientation: 1,
    parentAssetId: "A-parent",
  },
  "A-empty": {
    assetId: "A-empty",
    fileName: "A-empty.jpg",
    sha256: "dbc22aa4d92e765d16bf8a288bcee7214d2a42788e7672fa0d0ebc9ab783a6b9",
    decodedWidth: 320,
    decodedHeight: 240,
    encodedOrientation: 1,
    parentAssetId: "A-parent",
  },
  "A-gen": {
    assetId: "A-gen",
    fileName: "A-gen.jpg",
    sha256: "f907cae15ee9cd81b18db63a541688ba85585d18806276e1e9e5c15f5b3990a2",
    decodedWidth: 320,
    decodedHeight: 240,
    encodedOrientation: 1,
    parentAssetId: "A-parent",
  },
  "A-drift-b": {
    assetId: "A-drift-b",
    fileName: "A-drift-b.jpg",
    sha256: "dfddfdac51dca6ac42008699768d4decf5f7c29c09ac1f5f8b069e837cc5d572",
    decodedWidth: 320,
    decodedHeight: 240,
    encodedOrientation: 1,
    parentAssetId: "A-parent",
  },
  "P-stale-precondition": {
    assetId: "P-stale-precondition",
    fileName: "P-stale-precondition.jpg",
    sha256: "bd1937d7f6442d861f27c2b158a3171ee15860955345a2e701c1689ffb1b80f6",
    decodedWidth: 1280,
    decodedHeight: 720,
    encodedOrientation: 1,
    parentAssetId: null,
  },
} as const;

export type G0PayloadFixtureId = "P-coordinate-space-drift" | "P-legacy";

export type G0PayloadFixture = {
  readonly fixtureId: G0PayloadFixtureId;
  readonly payloadPath: string;
  readonly payloadIdentity: string;
  readonly payloadDigest: string;
};

export const G0_PAYLOAD_FIXTURE_BASE_DIR = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/payload-fixtures"
);

export const G0_PAYLOAD_FIXTURES: Record<G0PayloadFixtureId, G0PayloadFixture> = {
  "P-coordinate-space-drift": {
    fixtureId: "P-coordinate-space-drift",
    payloadPath: "P-coordinate-space-drift.v1.json",
    payloadIdentity: "payload-coordinate-space-drift-v1",
    payloadDigest: "cbb35f77c7e558ea2a4c983f9d3b27251dec1979ec14bffd882c88f0c2a35558",
  },
  "P-legacy": {
    fixtureId: "P-legacy",
    payloadPath: "P-legacy.v1.json",
    payloadIdentity: "payload-legacy-v1",
    payloadDigest: "27c3e478c35977c39db86f0123a0e85fa85f7ac8bec2cf809d5fcf45093c96e6",
  },
} as const;

export const G0_PARENT_FIXTURE_LINEAGE = {
  fixtureId: "g0-parent-authority-fixture-v1",
  basisId: "g0-parent-basis-v1",
  sourceAssetId: "A-parent-source-asset",
} as const;
