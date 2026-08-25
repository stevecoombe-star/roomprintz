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
  EMPTY: "Appearance-cleared diagnostic evidence.",
  FULLY_TILED:
    "Single tiled scaffold for Floor and room-envelope observation.",
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
      reason: "Run AFC to generate EMPTY diagnostic evidence.",
    },
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "Run AFC to generate the FULLY TILED room-envelope scaffold.",
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
      reason: "Run AFC to generate EMPTY diagnostic evidence.",
    },
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "Run AFC to generate the FULLY TILED room-envelope scaffold.",
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
    // EMPTY availability alone never aliases or enables FULLY_TILED.
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "unavailable",
      reason: "FULLY TILED has not been generated for this attempt.",
    },
  };
}

export function setFullyTiledRepresentation(
  state: RepresentationState,
  imageUrl: string,
): RepresentationState {
  return {
    ...state,
    FULLY_TILED: {
      kind: "FULLY_TILED",
      availability: "available",
      imageUrl,
    },
  };
}
