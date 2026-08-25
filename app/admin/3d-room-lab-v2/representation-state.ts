export const REPRESENTATION_KINDS = [
  "ORIGINAL",
  "EMPTY",
  "FULLY_TILED",
] as const;

export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number];

export const REPRESENTATION_LABELS: Record<RepresentationKind, string> = {
  ORIGINAL: "Original",
  EMPTY: "EMPTY",
  FULLY_TILED: "FULLY TILED",
};

export const REPRESENTATION_DESCRIPTIONS: Record<
  RepresentationKind,
  string
> = {
  ORIGINAL: "The accepted Original image basis.",
  EMPTY: "Appearance-cleared evidence generated for floor calibration.",
  FULLY_TILED:
    "Reserved for the future full-room architectural scaffold.",
};

export type OriginalImageSource = {
  type: "hosted-url";
  imageUrl: string;
};

export type AvailableRepresentation<
  Kind extends RepresentationKind = RepresentationKind,
> = {
  kind: Kind;
  availability: "available";
  imageUrl: string;
  source?: OriginalImageSource;
};

export type UnavailableRepresentation<
  Kind extends RepresentationKind = RepresentationKind,
> = {
  kind: Kind;
  availability: "unavailable";
  reason: string;
};

export type Representation<
  Kind extends RepresentationKind = RepresentationKind,
> =
  | AvailableRepresentation<Kind>
  | UnavailableRepresentation<Kind>;

export type RepresentationState = {
  [Kind in RepresentationKind]: Representation<Kind>;
};

export function createInitialRepresentationState(): RepresentationState {
  return {
    ORIGINAL: {
      kind: "ORIGINAL",
      availability: "unavailable",
      reason: "Load an Original room image to begin.",
    },
    EMPTY: {
      kind: "EMPTY",
      availability: "unavailable",
      reason: "Run certified floor AFC to generate EMPTY evidence.",
    },
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "FULLY TILED generation is not implemented in V2-S1.",
    },
  };
}

export function setOriginalRepresentation(
  state: RepresentationState,
  image: {
    imageUrl: string;
    source: OriginalImageSource;
  },
): RepresentationState {
  return {
    ...state,
    ORIGINAL: {
      kind: "ORIGINAL",
      availability: "available",
      imageUrl: image.imageUrl,
      source: image.source,
    },
    EMPTY: {
      kind: "EMPTY",
      availability: "unavailable",
      reason: "Run certified floor AFC to generate EMPTY evidence.",
    },
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "FULLY TILED is not implemented in V2-S2.",
    },
  };
}

export function setEmptyRepresentation(
  state: RepresentationState,
  imageUrl: string,
): RepresentationState {
  return {
    ...state,
    EMPTY: {
      kind: "EMPTY",
      availability: "available",
      imageUrl,
    },
    // Floor-only TILED is an internal calibration artifact. FULLY_TILED remains
    // intentionally unavailable until V2-S3.
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "FULLY TILED is not implemented in V2-S2.",
    },
  };
}
