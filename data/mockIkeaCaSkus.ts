// data/mockIkeaCaSkus.ts
export type FurnitureKind =
  | "sofa"
  | "loveseat"
  | "armchair"
  | "dining_table"
  | "dining_chair"
  | "coffee_table"
  | "side_table"
  | "bed"
  | "rug"
  | "floor_lamp";

export type IkeaCaSku = {
  skuId: string; // Vibode internal ID (stable)
  vendor: "IKEA_CA";
  ikeaFamily: string; // e.g. KIVIK, POÄNG
  displayName: string;
  kind: FurnitureKind;

  // IKEA identifiers
  articleNumber: string; // e.g. "894.406.04"
  productUrl: string; // ikea.com/ca/en
  imageUrl: string; // direct IKEA CDN image

  // We’ll run Vibode in imperial for now
  dimsIn: {
    width: number; // inches
    depth?: number; // inches
    height?: number; // inches
    diameter?: number; // inches (for round tables)
  };

  // Optional helpful metadata for later
  tags?: string[];
};

export const IKEA_CA_SKUS: IkeaCaSku[] = [
  {
    skuId: "ikea_ca_kivik_sofa_tibbleby_beige_gray_89440604",
    vendor: "IKEA_CA",
    ikeaFamily: "KIVIK",
    displayName: "KIVIK Sofa, Tibbleby beige/gray",
    kind: "sofa",
    articleNumber: "894.406.04",
    productUrl: "https://www.ikea.com/ca/en/p/kivik-sofa-tibbleby-beige-gray-s89440604/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/kivik-sofa-tibbleby-beige-gray__1056144_pe848277_s5.jpg?f=u",
    dimsIn: { width: 89.75, depth: 37.375, height: 32.625 }, // 89 3/4, 37 3/8, 32 5/8
    tags: ["living", "scandi", "neutral"],
  },
  {
    skuId: "ikea_ca_kivik_loveseat_tibbleby_beige_gray_59440605",
    vendor: "IKEA_CA",
    ikeaFamily: "KIVIK",
    displayName: "KIVIK Loveseat, Tibbleby beige/gray",
    kind: "loveseat",
    articleNumber: "594.406.05",
    productUrl: "https://www.ikea.com/ca/en/p/kivik-loveseat-tibbleby-beige-gray-s59440605/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/kivik-loveseat-tibbleby-beige-gray__1056142_pe848270_s5.jpg?f=u",
    dimsIn: { width: 74.75, depth: 37.375, height: 32.625 }, // 74 3/4, 37 3/8, 32 5/8
    tags: ["living", "small_space", "neutral"],
  },
  {
    skuId: "ikea_ca_poaeng_armchair_birch_gunnared_beige_09501979",
    vendor: "IKEA_CA",
    ikeaFamily: "POÄNG",
    displayName: "POÄNG Armchair, birch veneer/Gunnared beige",
    kind: "armchair",
    articleNumber: "095.019.79",
    productUrl: "https://www.ikea.com/ca/en/p/poaeng-armchair-birch-veneer-gunnared-beige-s09501979/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/poaeng-armchair-birch-veneer-gunnared-beige__1192140_pe900880_s5.jpg?f=u",
    dimsIn: { width: 26.75, depth: 32.25, height: 39.375 }, // 26 3/4, 32 1/4, 39 3/8
    tags: ["living", "accent", "wood"],
  },
  {
    skuId: "ikea_ca_skogsta_dining_table_acacia_black_70419264",
    vendor: "IKEA_CA",
    ikeaFamily: "SKOGSTA",
    displayName: "SKOGSTA Dining table, acacia/black",
    kind: "dining_table",
    articleNumber: "704.192.64",
    productUrl: "https://www.ikea.com/ca/en/p/skogsta-dining-table-acacia-black-70419264/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/skogsta-dining-table-acacia-black__1499941_pe1006841_s5.jpg?f=u",
    dimsIn: { width: 92.5, depth: 39.375, height: 29.125 }, // 92 1/2, 39 3/8, 29 1/8
    tags: ["dining", "wood", "statement"],
  },
  {
    skuId: "ikea_ca_bergmund_chair_black_gunnared_medium_gray_09471699",
    vendor: "IKEA_CA",
    ikeaFamily: "BERGMUND",
    displayName: "BERGMUND Chair, black/Gunnared medium gray",
    kind: "dining_chair",
    articleNumber: "094.716.99",
    productUrl: "https://www.ikea.com/ca/en/p/bergmund-chair-black-gunnared-medium-gray-s09471699/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/bergmund-chair-black-gunnared-medium-gray__0859533_pe780957_s5.jpg?f=u",
    dimsIn: { width: 20.5, depth: 23.25, height: 37.375 }, // 20 1/2, 23 1/4, 37 3/8
    tags: ["dining", "upholstered"],
  },
  {
    skuId: "ikea_ca_lack_coffee_table_white_90449905",
    vendor: "IKEA_CA",
    ikeaFamily: "LACK",
    displayName: "LACK Coffee table, white",
    kind: "coffee_table",
    articleNumber: "904.499.05",
    productUrl: "https://www.ikea.com/ca/en/p/lack-coffee-table-white-90449905/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/lack-coffee-table-white__0750652_pe746803_s5.jpg?f=u",
    dimsIn: { width: 35.375, depth: 21.625, height: 17.75 }, // 35 3/8, 21 5/8, 17 3/4
    tags: ["living", "budget", "white"],
  },
  {
    skuId: "ikea_ca_gladom_tray_table_black_50411990",
    vendor: "IKEA_CA",
    ikeaFamily: "GLADOM",
    displayName: "GLADOM Tray table, black",
    kind: "side_table",
    articleNumber: "504.119.90",
    productUrl: "https://www.ikea.com/ca/en/p/gladom-tray-table-black-50411990/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/gladom-tray-table-black__0567223_pe664991_s5.jpg?f=u",
    dimsIn: { width: 17.5, depth: 17.5, diameter: 17.5, height: 20.625 }, // Ø17 1/2, H 20 5/8
    tags: ["living", "small_space", "black"],
  },
  {
    skuId: "ikea_ca_hektar_floor_lamp_3_spotlights_dark_gray_40393618",
    vendor: "IKEA_CA",
    ikeaFamily: "HEKTAR",
    displayName: "HEKTAR Floor lamp with 3-spotlights, dark gray",
    kind: "floor_lamp",
    articleNumber: "403.936.18",
    productUrl: "https://www.ikea.com/ca/en/p/hektar-floor-lamp-with-3-spotlights-dark-gray-40393618/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/hektar-floor-lamp-with-3-spotlights-dark-gray__0606224_pe682139_s5.jpg?f=u",
    dimsIn: { width: 12, depth: 12, diameter: 12, height: 69 }, // H 69", base Ø 12"
    tags: ["lighting", "industrial", "black"],
  },
  {
    skuId: "ikea_ca_malm_bed_frame_high_white_queen_19931605",
    vendor: "IKEA_CA",
    ikeaFamily: "MALM",
    displayName: "MALM Bed frame, high, white (Queen)",
    kind: "bed",
    articleNumber: "199.316.05",
    productUrl: "https://www.ikea.com/ca/en/p/malm-bed-frame-high-white-s19931605/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/malm-bed-frame-high-white__0749130_pe745499_s5.jpg?f=u",
    // NOTE: MALM’s page exposes multiple measurements; for the editor’s “footprint”
    // we care about bed length/width + headboard height as the “height”.
    // (We can refine to separate "frame height" vs "headboard height" later.)
    dimsIn: { width: 65.0, depth: 83.125, height: 39.375 },
    tags: ["bedroom", "white", "minimal"],
  },
  {
    skuId: "ikea_ca_lohals_rug_flatwoven_natural_200x300_00277395",
    vendor: "IKEA_CA",
    ikeaFamily: "LOHALS",
    displayName: "LOHALS Rug, flatwoven, natural (6'7\" x 9'10\")",
    kind: "rug",
    articleNumber: "002.773.95",
    productUrl: "https://www.ikea.com/ca/en/p/lohals-rug-flatwoven-natural-00277395/",
    imageUrl:
      "https://www.ikea.com/ca/en/images/products/lohals-rug-flatwoven-natural__0280230_pe419175_s5.jpg?f=u",
    dimsIn: { width: 78.75, depth: 118.0, height: 0.5 }, // 6'7"=78.75, 9'10"=118, thickness ~1/2"
    tags: ["rug", "jute", "natural"],
  },
];

export const IKEA_CA_SKU_BY_ID: Record<string, IkeaCaSku> = Object.fromEntries(
  IKEA_CA_SKUS.map((s) => [s.skuId, s]),
);
