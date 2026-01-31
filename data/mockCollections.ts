// data/mockCollections.ts

export type VariantOption = { variantId: string; label: string };

export type CatalogSku = {
  skuId: string;
  label: string;

  // Source-of-truth for scale (ft). Used with calibration ppf when present.
  realWidthFt?: number;
  realDepthFt?: number;
  realHeightFt?: number;

  // Fallback (stage px) if no calibration is available.
  defaultPxWidth: number;
  defaultPxHeight: number;

  variants?: VariantOption[];
};

export type RoomSizeBundleId = "small" | "medium" | "large";

export type FurnitureCollection = {
  collectionId: string;
  label: string;

  bundles: Record<
    RoomSizeBundleId,
    {
      label: string;
      skuIds: string[];
    }
  >;

  catalog: Record<string, CatalogSku>;
};

/**
 * NOTE:
 * - These are “good-enough” mock IKEA-inspired examples for editor wiring.
 * - realWidthFt/realDepthFt drive pixel sizing when calibration.ppf exists.
 * - defaultPxWidth/defaultPxHeight are fallback sizing if no calibration.
 */
export const MOCK_COLLECTIONS: FurnitureCollection[] = [
  /* =========================================================
     COLLECTION 1 — Modern Scandi (IKEA-inspired)
  ========================================================= */
  {
    collectionId: "ikea-modern-scandi-a",
    label: "IKEA — Modern Scandi A",
    bundles: {
      small: {
        label: "Small Room Bundle",
        skuIds: [
          "sofa-klippan-2s",
          "chair-poang",
          "coffee-listerby-110",
          "rug-lohals-160x230",
          "lamp-hektar-floor",
          "side-lack-55",
        ],
      },
      medium: {
        label: "Medium Room Bundle",
        skuIds: [
          "sofa-kivik-3s",
          "chair-poang",
          "chair-strandmon",
          "coffee-stockholm-180",
          "rug-lohals-200x300",
          "lamp-sinnerlig-floor",
          "side-vittsjo",
        ],
      },
      large: {
        label: "Large Room Bundle",
        skuIds: [
          "sofa-soderhamn-4s",
          "chair-strandmon",
          "chair-poang",
          "coffee-stockholm-180",
          "side-kallax-77x77",
          "rug-lohals-200x300",
          "lamp-arstid-floor",
          "tv-besta-180",
        ],
      },
    },
    catalog: {
      /* Sofas */
      "sofa-klippan-2s": {
        skuId: "sofa-klippan-2s",
        label: "KLIPPAN Loveseat — 70in",
        realWidthFt: 70 / 12,
        realDepthFt: 35 / 12,
        realHeightFt: 26 / 12,
        defaultPxWidth: 240,
        defaultPxHeight: 130,
        variants: [
          { variantId: "vissle-gray", label: "Vissle — Gray" },
          { variantId: "vissle-beige", label: "Vissle — Beige" },
          { variantId: "vissle-blue", label: "Vissle — Blue" },
        ],
      },
      "sofa-kivik-3s": {
        skuId: "sofa-kivik-3s",
        label: "KIVIK Sofa — 90in",
        realWidthFt: 90 / 12,
        realDepthFt: 37 / 12,
        realHeightFt: 32 / 12,
        defaultPxWidth: 290,
        defaultPxHeight: 140,
        variants: [
          { variantId: "tresund-anthracite", label: "Tresund — Anthracite" },
          { variantId: "tibbleby-beige", label: "Tibbleby — Beige/Gray" },
          { variantId: "kelinge-gray", label: "Kelinge — Gray/Turquoise" },
        ],
      },
      "sofa-soderhamn-4s": {
        skuId: "sofa-soderhamn-4s",
        label: "SÖDERHAMN Sofa — 4 seat",
        realWidthFt: 114 / 12,
        realDepthFt: 39 / 12,
        realHeightFt: 27 / 12,
        defaultPxWidth: 360,
        defaultPxHeight: 150,
        variants: [
          { variantId: "finnsta-white", label: "Finnsta — White" },
          { variantId: "tonerud-gray", label: "Tonerud — Gray" },
          { variantId: "fridtuna-lightbeige", label: "Fridtuna — Light Beige" },
        ],
      },

      /* Chairs */
      "chair-poang": {
        skuId: "chair-poang",
        label: "POÄNG Armchair",
        realWidthFt: 26 / 12,
        realDepthFt: 32 / 12,
        realHeightFt: 39 / 12,
        defaultPxWidth: 120,
        defaultPxHeight: 140,
        variants: [
          { variantId: "birch-veneer", label: "Birch Veneer" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-veneer", label: "Oak Veneer" },
        ],
      },
      "chair-strandmon": {
        skuId: "chair-strandmon",
        label: "STRANDMON Wing Chair",
        realWidthFt: 32 / 12,
        realDepthFt: 38 / 12,
        realHeightFt: 40 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 160,
        variants: [
          { variantId: "nordvalla-darkgray", label: "Nordvalla — Dark Gray" },
          { variantId: "skiftebo-yellow", label: "Skiftebo — Yellow" },
          { variantId: "djuparp-darkgreen", label: "Djuparp — Dark Green" },
        ],
      },

      /* Coffee tables */
      "coffee-listerby-110": {
        skuId: "coffee-listerby-110",
        label: "LISTERBY Coffee Table — 43in",
        realWidthFt: 43 / 12,
        realDepthFt: 23 / 12,
        realHeightFt: 20 / 12,
        defaultPxWidth: 190,
        defaultPxHeight: 110,
        variants: [
          { variantId: "oak-veneer", label: "Oak Veneer" },
          { variantId: "dark-brown-beech", label: "Dark Brown Beech" },
        ],
      },
      "coffee-stockholm-180": {
        skuId: "coffee-stockholm-180",
        label: "STOCKHOLM Coffee Table — 70in",
        realWidthFt: 70 / 12,
        realDepthFt: 23 / 12,
        realHeightFt: 16 / 12,
        defaultPxWidth: 290,
        defaultPxHeight: 120,
        variants: [
          { variantId: "walnut-veneer", label: "Walnut Veneer" },
          { variantId: "oak-veneer", label: "Oak Veneer" },
        ],
      },

      /* Side tables / shelving */
      "side-lack-55": {
        skuId: "side-lack-55",
        label: "LACK Side Table — 22in",
        realWidthFt: 22 / 12,
        realDepthFt: 22 / 12,
        realHeightFt: 18 / 12,
        defaultPxWidth: 95,
        defaultPxHeight: 95,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-effect", label: "Oak Effect" },
        ],
      },
      "side-vittsjo": {
        skuId: "side-vittsjo",
        label: "VITTSJÖ Laptop/Side Table — 39in",
        realWidthFt: 39 / 12,
        realDepthFt: 14 / 12,
        realHeightFt: 29 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 85,
        variants: [
          { variantId: "black-brown-glass", label: "Black-Brown / Glass" },
          { variantId: "white-glass", label: "White / Glass" },
        ],
      },
      "side-kallax-77x77": {
        skuId: "side-kallax-77x77",
        label: "KALLAX Shelf Unit — 30x30",
        realWidthFt: 30 / 12,
        realDepthFt: 15 / 12,
        realHeightFt: 30 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 110,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-effect", label: "Oak Effect" },
        ],
      },

      /* Rugs */
      "rug-lohals-160x230": {
        skuId: "rug-lohals-160x230",
        label: "LOHALS Rug — 5'3\" x 7'7\"",
        realWidthFt: 5.25,
        realDepthFt: 7.6,
        defaultPxWidth: 260,
        defaultPxHeight: 360,
        variants: [
          { variantId: "natural", label: "Natural" },
          { variantId: "natural-dark", label: "Natural / Dark" },
        ],
      },
      "rug-lohals-200x300": {
        skuId: "rug-lohals-200x300",
        label: "LOHALS Rug — 6'7\" x 9'10\"",
        realWidthFt: 6.6,
        realDepthFt: 9.83,
        defaultPxWidth: 320,
        defaultPxHeight: 480,
        variants: [
          { variantId: "natural", label: "Natural" },
          { variantId: "natural-dark", label: "Natural / Dark" },
        ],
      },

      /* Floor lamps */
      "lamp-hektar-floor": {
        skuId: "lamp-hektar-floor",
        label: "HEKTAR Floor Lamp — 69in",
        realWidthFt: 12 / 12, // footprint approx
        realDepthFt: 12 / 12,
        realHeightFt: 69 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 220,
        variants: [
          { variantId: "dark-gray", label: "Dark Gray" },
          { variantId: "white", label: "White" },
        ],
      },
      "lamp-sinnerlig-floor": {
        skuId: "lamp-sinnerlig-floor",
        label: "SINNERLIG Floor Lamp — 59in",
        realWidthFt: 14 / 12,
        realDepthFt: 14 / 12,
        realHeightFt: 59 / 12,
        defaultPxWidth: 80,
        defaultPxHeight: 200,
        variants: [
          { variantId: "bamboo", label: "Bamboo" },
          { variantId: "black", label: "Black" },
        ],
      },
      "lamp-arstid-floor": {
        skuId: "lamp-arstid-floor",
        label: "ÅRSTID Floor Lamp — 61in",
        realWidthFt: 12 / 12,
        realDepthFt: 12 / 12,
        realHeightFt: 61 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 210,
        variants: [
          { variantId: "brass-white", label: "Brass / White Shade" },
          { variantId: "nickel-white", label: "Nickel / White Shade" },
        ],
      },

      /* Media */
      "tv-besta-180": {
        skuId: "tv-besta-180",
        label: "BESTÅ TV Unit — 71in",
        realWidthFt: 71 / 12,
        realDepthFt: 16 / 12,
        realHeightFt: 20 / 12,
        defaultPxWidth: 260,
        defaultPxHeight: 90,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "walnut-effect", label: "Walnut Effect" },
        ],
      },
    },
  },

  /* =========================================================
     COLLECTION 2 — Cozy Neutral (IKEA-inspired)
  ========================================================= */
  {
    collectionId: "ikea-cozy-neutral-b",
    label: "IKEA — Cozy Neutral B",
    bundles: {
      small: {
        label: "Small Room Bundle",
        skuIds: [
          "sofa-friheten",
          "chair-ektorp-chair",
          "coffee-fjallbo",
          "rug-vindum-170x230",
          "lamp-lersta-floor",
          "side-nordkisa",
        ],
      },
      medium: {
        label: "Medium Room Bundle",
        skuIds: [
          "sofa-finnala-3s",
          "chair-ektorp-chair",
          "chair-poang",
          "coffee-fjallbo",
          "rug-vindum-200x300",
          "lamp-lersta-floor",
          "side-hemnes",
        ],
      },
      large: {
        label: "Large Room Bundle",
        skuIds: [
          "sofa-finnala-3s",
          "sofa-friheten",
          "chair-strandmon",
          "coffee-fjallbo",
          "side-hemnes",
          "rug-vindum-200x300",
          "lamp-lersta-floor",
          "lamp-hektar-floor",
        ],
      },
    },
    catalog: {
      /* Sofas */
      "sofa-friheten": {
        skuId: "sofa-friheten",
        label: "FRIHETEN Sleeper Sofa — 90in",
        realWidthFt: 90 / 12,
        realDepthFt: 41 / 12,
        realHeightFt: 26 / 12,
        defaultPxWidth: 310,
        defaultPxHeight: 160,
        variants: [
          { variantId: "dark-gray", label: "Dark Gray" },
          { variantId: "beige", label: "Beige" },
          { variantId: "blue", label: "Blue" },
        ],
      },
      "sofa-finnala-3s": {
        skuId: "sofa-finnala-3s",
        label: "FINNALA Sofa — 3 seat",
        realWidthFt: 88 / 12,
        realDepthFt: 39 / 12,
        realHeightFt: 33 / 12,
        defaultPxWidth: 295,
        defaultPxHeight: 155,
        variants: [
          { variantId: "gunnared-mediumgray", label: "Gunnared — Medium Gray" },
          { variantId: "gunnared-beige", label: "Gunnared — Beige" },
          { variantId: "tallmyra-black", label: "Tallmyra — Black/Gray" },
        ],
      },

      /* Chairs */
      "chair-ektorp-chair": {
        skuId: "chair-ektorp-chair",
        label: "EKTORP Armchair",
        realWidthFt: 41 / 12,
        realDepthFt: 35 / 12,
        realHeightFt: 35 / 12,
        defaultPxWidth: 170,
        defaultPxHeight: 150,
        variants: [
          { variantId: "hallarp-gray", label: "Hallarp — Gray" },
          { variantId: "nordvalla-beige", label: "Nordvalla — Beige" },
          { variantId: "liden-white", label: "White" },
        ],
      },
      "chair-strandmon": {
        skuId: "chair-strandmon",
        label: "STRANDMON Wing Chair",
        realWidthFt: 32 / 12,
        realDepthFt: 38 / 12,
        realHeightFt: 40 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 160,
        variants: [
          { variantId: "nordvalla-darkgray", label: "Nordvalla — Dark Gray" },
          { variantId: "skiftebo-yellow", label: "Skiftebo — Yellow" },
          { variantId: "djuparp-darkgreen", label: "Djuparp — Dark Green" },
        ],
      },
      "chair-poang": {
        skuId: "chair-poang",
        label: "POÄNG Armchair",
        realWidthFt: 26 / 12,
        realDepthFt: 32 / 12,
        realHeightFt: 39 / 12,
        defaultPxWidth: 120,
        defaultPxHeight: 140,
        variants: [
          { variantId: "birch-veneer", label: "Birch Veneer" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-veneer", label: "Oak Veneer" },
        ],
      },

      /* Tables */
      "coffee-fjallbo": {
        skuId: "coffee-fjallbo",
        label: "FJÄLLBO Coffee Table — 35in",
        realWidthFt: 35 / 12,
        realDepthFt: 18 / 12,
        realHeightFt: 18 / 12,
        defaultPxWidth: 160,
        defaultPxHeight: 95,
        variants: [
          { variantId: "black-metal", label: "Black / Metal" },
          { variantId: "blackwood", label: "Black / Wood" },
        ],
      },

      /* Side tables / storage */
      "side-nordkisa": {
        skuId: "side-nordkisa",
        label: "NORDKISA Nightstand — 16in",
        realWidthFt: 16 / 12,
        realDepthFt: 16 / 12,
        realHeightFt: 24 / 12,
        defaultPxWidth: 85,
        defaultPxHeight: 85,
        variants: [
          { variantId: "bamboo", label: "Bamboo" },
          { variantId: "stained", label: "Stained Bamboo" },
        ],
      },
      "side-hemnes": {
        skuId: "side-hemnes",
        label: "HEMNES Side Table — 18in",
        realWidthFt: 18 / 12,
        realDepthFt: 18 / 12,
        realHeightFt: 21 / 12,
        defaultPxWidth: 90,
        defaultPxHeight: 90,
        variants: [
          { variantId: "white-stain", label: "White Stain" },
          { variantId: "black-brown", label: "Black-Brown" },
        ],
      },

      /* Rugs */
      "rug-vindum-170x230": {
        skuId: "rug-vindum-170x230",
        label: "VINDUM Rug — 5'7\" x 7'7\"",
        realWidthFt: 5.58,
        realDepthFt: 7.58,
        defaultPxWidth: 280,
        defaultPxHeight: 380,
        variants: [
          { variantId: "highpile-white", label: "High Pile — White" },
          { variantId: "highpile-gray", label: "High Pile — Gray" },
        ],
      },
      "rug-vindum-200x300": {
        skuId: "rug-vindum-200x300",
        label: "VINDUM Rug — 6'7\" x 9'10\"",
        realWidthFt: 6.6,
        realDepthFt: 9.83,
        defaultPxWidth: 330,
        defaultPxHeight: 490,
        variants: [
          { variantId: "highpile-white", label: "High Pile — White" },
          { variantId: "highpile-gray", label: "High Pile — Gray" },
        ],
      },

      /* Lamps */
      "lamp-lersta-floor": {
        skuId: "lamp-lersta-floor",
        label: "LÅRSTA / LERSTA Floor/Reading Lamp — 55in",
        realWidthFt: 10 / 12,
        realDepthFt: 10 / 12,
        realHeightFt: 55 / 12,
        defaultPxWidth: 65,
        defaultPxHeight: 200,
        variants: [
          { variantId: "aluminum", label: "Aluminum" },
          { variantId: "black", label: "Black" },
        ],
      },
      "lamp-hektar-floor": {
        skuId: "lamp-hektar-floor",
        label: "HEKTAR Floor Lamp — 69in",
        realWidthFt: 12 / 12,
        realDepthFt: 12 / 12,
        realHeightFt: 69 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 220,
        variants: [
          { variantId: "dark-gray", label: "Dark Gray" },
          { variantId: "white", label: "White" },
        ],
      },
    },
  },

  /* =========================================================
     COLLECTION 3 — Compact Studio (IKEA-inspired)
  ========================================================= */
  {
    collectionId: "ikea-compact-studio-c",
    label: "IKEA — Compact Studio C",
    bundles: {
      small: {
        label: "Small Room Bundle",
        skuIds: [
          "sofa-vimle-2s",
          "chair-poang",
          "coffee-lack-90x55",
          "rug-tiphede-160x230",
          "lamp-nymane-floor",
          "side-kallax-42x77",
        ],
      },
      medium: {
        label: "Medium Room Bundle",
        skuIds: [
          "sofa-vimle-2s",
          "sofa-klippan-2s",
          "chair-poang",
          "coffee-listerby-110",
          "rug-tiphede-200x300",
          "lamp-nymane-floor",
          "side-vittsjo",
        ],
      },
      large: {
        label: "Large Room Bundle",
        skuIds: [
          "sofa-kivik-3s",
          "sofa-vimle-2s",
          "chair-strandmon",
          "coffee-stockholm-180",
          "rug-tiphede-200x300",
          "lamp-hektar-floor",
          "side-kallax-77x77",
          "tv-besta-180",
        ],
      },
    },
    catalog: {
      "sofa-vimle-2s": {
        skuId: "sofa-vimle-2s",
        label: "VIMLE Loveseat — 67in",
        realWidthFt: 67 / 12,
        realDepthFt: 39 / 12,
        realHeightFt: 32 / 12,
        defaultPxWidth: 240,
        defaultPxHeight: 150,
        variants: [
          { variantId: "gunnared-beige", label: "Gunnared — Beige" },
          { variantId: "gunnared-mediumgray", label: "Gunnared — Medium Gray" },
          { variantId: "hallarp-gray", label: "Hallarp — Gray" },
        ],
      },
      "sofa-klippan-2s": {
        skuId: "sofa-klippan-2s",
        label: "KLIPPAN Loveseat — 70in",
        realWidthFt: 70 / 12,
        realDepthFt: 35 / 12,
        realHeightFt: 26 / 12,
        defaultPxWidth: 240,
        defaultPxHeight: 130,
        variants: [
          { variantId: "vissle-gray", label: "Vissle — Gray" },
          { variantId: "vissle-beige", label: "Vissle — Beige" },
          { variantId: "vissle-blue", label: "Vissle — Blue" },
        ],
      },
      "sofa-kivik-3s": {
        skuId: "sofa-kivik-3s",
        label: "KIVIK Sofa — 90in",
        realWidthFt: 90 / 12,
        realDepthFt: 37 / 12,
        realHeightFt: 32 / 12,
        defaultPxWidth: 290,
        defaultPxHeight: 140,
        variants: [
          { variantId: "tresund-anthracite", label: "Tresund — Anthracite" },
          { variantId: "tibbleby-beige", label: "Tibbleby — Beige/Gray" },
          { variantId: "kelinge-gray", label: "Kelinge — Gray/Turquoise" },
        ],
      },

      "chair-poang": {
        skuId: "chair-poang",
        label: "POÄNG Armchair",
        realWidthFt: 26 / 12,
        realDepthFt: 32 / 12,
        realHeightFt: 39 / 12,
        defaultPxWidth: 120,
        defaultPxHeight: 140,
        variants: [
          { variantId: "birch-veneer", label: "Birch Veneer" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-veneer", label: "Oak Veneer" },
        ],
      },
      "chair-strandmon": {
        skuId: "chair-strandmon",
        label: "STRANDMON Wing Chair",
        realWidthFt: 32 / 12,
        realDepthFt: 38 / 12,
        realHeightFt: 40 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 160,
        variants: [
          { variantId: "nordvalla-darkgray", label: "Nordvalla — Dark Gray" },
          { variantId: "skiftebo-yellow", label: "Skiftebo — Yellow" },
          { variantId: "djuparp-darkgreen", label: "Djuparp — Dark Green" },
        ],
      },

      "coffee-lack-90x55": {
        skuId: "coffee-lack-90x55",
        label: "LACK Coffee Table — 35in",
        realWidthFt: 35 / 12,
        realDepthFt: 22 / 12,
        realHeightFt: 18 / 12,
        defaultPxWidth: 160,
        defaultPxHeight: 100,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-effect", label: "Oak Effect" },
        ],
      },
      "coffee-listerby-110": {
        skuId: "coffee-listerby-110",
        label: "LISTERBY Coffee Table — 43in",
        realWidthFt: 43 / 12,
        realDepthFt: 23 / 12,
        realHeightFt: 20 / 12,
        defaultPxWidth: 190,
        defaultPxHeight: 110,
        variants: [
          { variantId: "oak-veneer", label: "Oak Veneer" },
          { variantId: "dark-brown-beech", label: "Dark Brown Beech" },
        ],
      },
      "coffee-stockholm-180": {
        skuId: "coffee-stockholm-180",
        label: "STOCKHOLM Coffee Table — 70in",
        realWidthFt: 70 / 12,
        realDepthFt: 23 / 12,
        realHeightFt: 16 / 12,
        defaultPxWidth: 290,
        defaultPxHeight: 120,
        variants: [
          { variantId: "walnut-veneer", label: "Walnut Veneer" },
          { variantId: "oak-veneer", label: "Oak Veneer" },
        ],
      },

      "side-kallax-42x77": {
        skuId: "side-kallax-42x77",
        label: "KALLAX Shelf Unit — 16x30",
        realWidthFt: 16 / 12,
        realDepthFt: 15 / 12,
        realHeightFt: 30 / 12,
        defaultPxWidth: 105,
        defaultPxHeight: 110,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-effect", label: "Oak Effect" },
        ],
      },
      "side-kallax-77x77": {
        skuId: "side-kallax-77x77",
        label: "KALLAX Shelf Unit — 30x30",
        realWidthFt: 30 / 12,
        realDepthFt: 15 / 12,
        realHeightFt: 30 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 110,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "oak-effect", label: "Oak Effect" },
        ],
      },
      "side-vittsjo": {
        skuId: "side-vittsjo",
        label: "VITTSJÖ Laptop/Side Table — 39in",
        realWidthFt: 39 / 12,
        realDepthFt: 14 / 12,
        realHeightFt: 29 / 12,
        defaultPxWidth: 150,
        defaultPxHeight: 85,
        variants: [
          { variantId: "black-brown-glass", label: "Black-Brown / Glass" },
          { variantId: "white-glass", label: "White / Glass" },
        ],
      },

      "rug-tiphede-160x230": {
        skuId: "rug-tiphede-160x230",
        label: "TIPHEDE Rug — 5'3\" x 7'7\"",
        realWidthFt: 5.25,
        realDepthFt: 7.6,
        defaultPxWidth: 260,
        defaultPxHeight: 360,
        variants: [
          { variantId: "natural-black", label: "Natural / Black" },
          { variantId: "natural", label: "Natural" },
        ],
      },
      "rug-tiphede-200x300": {
        skuId: "rug-tiphede-200x300",
        label: "TIPHEDE Rug — 6'7\" x 9'10\"",
        realWidthFt: 6.6,
        realDepthFt: 9.83,
        defaultPxWidth: 320,
        defaultPxHeight: 480,
        variants: [
          { variantId: "natural-black", label: "Natural / Black" },
          { variantId: "natural", label: "Natural" },
        ],
      },

      "lamp-nymane-floor": {
        skuId: "lamp-nymane-floor",
        label: "NYMÅNE Floor Lamp — 59in",
        realWidthFt: 12 / 12,
        realDepthFt: 12 / 12,
        realHeightFt: 59 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 205,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "anthracite", label: "Anthracite" },
        ],
      },
      "lamp-hektar-floor": {
        skuId: "lamp-hektar-floor",
        label: "HEKTAR Floor Lamp — 69in",
        realWidthFt: 12 / 12,
        realDepthFt: 12 / 12,
        realHeightFt: 69 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 220,
        variants: [
          { variantId: "dark-gray", label: "Dark Gray" },
          { variantId: "white", label: "White" },
        ],
      },

      "tv-besta-180": {
        skuId: "tv-besta-180",
        label: "BESTÅ TV Unit — 71in",
        realWidthFt: 71 / 12,
        realDepthFt: 16 / 12,
        realHeightFt: 20 / 12,
        defaultPxWidth: 260,
        defaultPxHeight: 90,
        variants: [
          { variantId: "white", label: "White" },
          { variantId: "black-brown", label: "Black-Brown" },
          { variantId: "walnut-effect", label: "Walnut Effect" },
        ],
      },
    },
  },

  /* =========================================================
    COLLECTION 4 — IKEA Canada Reference Set (Real SKUs)
  ========================================================= */
  {
    collectionId: "ikea-ca-reference-v01",
    label: "IKEA Canada — Reference Set (Real SKUs)",
    bundles: {
      small: {
        label: "Small Room Bundle",
        skuIds: [
          "sofa-kivik-3s-ca",
          "chair-poang-ca",
          "coffee-lack-90x55-ca",
          "side-gladom-ca",
          "lamp-hektar-floor-3spot-ca",
          "rug-lohals-200x300-ca",
        ],
      },
      medium: {
        label: "Medium Room Bundle",
        skuIds: [
          "sofa-kivik-3s-ca",
          "sofa-kivik-loveseat-ca",
          "chair-poang-ca",
          "coffee-lack-90x55-ca",
          "side-gladom-ca",
          "lamp-hektar-floor-3spot-ca",
          "rug-lohals-200x300-ca",
        ],
      },
      large: {
        label: "Large Room Bundle",
        skuIds: [
          "sofa-kivik-3s-ca",
          "sofa-kivik-loveseat-ca",
          "chair-poang-ca",
          "dining-skogsta-235x100-ca",
          "chair-bergmund-ca",
          "bed-malm-queen-ca",
          "coffee-lack-90x55-ca",
          "side-gladom-ca",
          "lamp-hektar-floor-3spot-ca",
          "rug-lohals-200x300-ca",
        ],
      },
    },
    catalog: {
      /* Sofas */
      "sofa-kivik-3s-ca": {
        skuId: "sofa-kivik-3s-ca",
        label: "KIVIK Sofa (IKEA CA) — 89 3/4in",
        realWidthFt: 89.75 / 12,
        realDepthFt: 37.375 / 12,
        realHeightFt: 32.625 / 12,
        defaultPxWidth: 290,
        defaultPxHeight: 140,
        variants: [{ variantId: "tibbleby-beige-gray", label: "Tibbleby — Beige/Gray" }],
      },
      "sofa-kivik-loveseat-ca": {
        skuId: "sofa-kivik-loveseat-ca",
        label: "KIVIK Loveseat (IKEA CA) — 74 3/4in",
        realWidthFt: 74.75 / 12,
        realDepthFt: 37.375 / 12,
        realHeightFt: 32.625 / 12,
        defaultPxWidth: 250,
        defaultPxHeight: 135,
        variants: [{ variantId: "tibbleby-beige-gray", label: "Tibbleby — Beige/Gray" }],
      },

      /* Chairs */
      "chair-poang-ca": {
        skuId: "chair-poang-ca",
        label: "POÄNG Armchair (IKEA CA)",
        realWidthFt: 26.75 / 12,
        realDepthFt: 32.25 / 12,
        realHeightFt: 39.375 / 12,
        defaultPxWidth: 120,
        defaultPxHeight: 140,
        variants: [{ variantId: "birch-gunnared-beige", label: "Birch / Gunnared Beige" }],
      },
      "chair-bergmund-ca": {
        skuId: "chair-bergmund-ca",
        label: "BERGMUND Dining Chair (IKEA CA)",
        realWidthFt: 20.5 / 12,
        realDepthFt: 23.25 / 12,
        realHeightFt: 37.375 / 12,
        defaultPxWidth: 105,
        defaultPxHeight: 130,
        variants: [{ variantId: "black-gunnared-gray", label: "Black / Gunnared Medium Gray" }],
      },

      /* Tables */
      "coffee-lack-90x55-ca": {
        skuId: "coffee-lack-90x55-ca",
        label: "LACK Coffee Table (IKEA CA) — 35 3/8in",
        realWidthFt: 35.375 / 12,
        realDepthFt: 21.625 / 12,
        realHeightFt: 17.75 / 12,
        defaultPxWidth: 220,
        defaultPxHeight: 135,
        variants: [{ variantId: "white", label: "White" }],
      },
      "dining-skogsta-235x100-ca": {
        skuId: "dining-skogsta-235x100-ca",
        label: "SKOGSTA Dining Table (IKEA CA) — 92 1/2in",
        realWidthFt: 92.5 / 12,
        realDepthFt: 39.375 / 12,
        realHeightFt: 29.125 / 12,
        defaultPxWidth: 360,
        defaultPxHeight: 170,
        variants: [{ variantId: "acacia-black", label: "Acacia / Black" }],
      },

      /* Side tables */
      "side-gladom-ca": {
        skuId: "side-gladom-ca",
        label: "GLADOM Tray Table (IKEA CA) — Ø17 1/2in",
        realWidthFt: 17.5 / 12,
        realDepthFt: 17.5 / 12,
        realHeightFt: 20.625 / 12,
        defaultPxWidth: 95,
        defaultPxHeight: 95,
        variants: [{ variantId: "black", label: "Black" }],
      },

      /* Rugs */
      "rug-lohals-200x300-ca": {
        skuId: "rug-lohals-200x300-ca",
        label: "LOHALS Rug (IKEA CA) — 6'7\" x 9'10\"",
        realWidthFt: 78.75 / 12,
        realDepthFt: 118 / 12,
        defaultPxWidth: 320,
        defaultPxHeight: 480,
        variants: [{ variantId: "natural", label: "Natural" }],
      },

      /* Floor lamps */
      "lamp-hektar-floor-3spot-ca": {
        skuId: "lamp-hektar-floor-3spot-ca",
        label: "HEKTAR Floor Lamp (IKEA CA) — 69in",
        realWidthFt: 12 / 12, // footprint approx
        realDepthFt: 12 / 12,
        realHeightFt: 69 / 12,
        defaultPxWidth: 70,
        defaultPxHeight: 220,
        variants: [{ variantId: "dark-gray", label: "Dark Gray" }],
      },

      /* Beds */
      "bed-malm-queen-ca": {
        skuId: "bed-malm-queen-ca",
        label: "MALM Bed Frame (IKEA CA) — Queen",
        realWidthFt: 65 / 12,
        realDepthFt: 83.125 / 12,
        realHeightFt: 39.375 / 12, // using headboard height as “height”
        defaultPxWidth: 320,
        defaultPxHeight: 420,
        variants: [{ variantId: "white", label: "White" }],
      },
    },
  },
];
