export const REPRESENTATION_KINDS = [
  "ORIGINAL",
  "EMPTY",
  "TILED",
] as const;

export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number];

export const REPRESENTATION_LABELS: Record<RepresentationKind, string> = {
  ORIGINAL: "Original",
  EMPTY: "EMPTY",
  TILED: "TILED",
};

export const REPRESENTATION_DESCRIPTIONS: Record<
  RepresentationKind,
  string
> = {
  ORIGINAL: "The accepted Original image basis.",
  EMPTY: "Appearance-cleared diagnostic evidence.",
  TILED: "Floor-only tiled perspective authority generated from EMPTY.",
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
    TILED: {
      kind: "TILED",
      availability: "unavailable",
      reason: "Run AFC to generate the floor-only TILED authority scaffold.",
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
    TILED: {
      kind: "TILED",
      availability: "unavailable",
      reason: "Run AFC to generate the floor-only TILED authority scaffold.",
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
    // EMPTY availability alone never aliases or enables TILED.
    TILED: {
      kind: "TILED",
      availability: "unavailable",
      reason: "TILED has not been generated from this EMPTY.",
    },
  };
}

export function setTiledRepresentation(
  state: RepresentationState,
  imageUrl: string,
): RepresentationState {
  return {
    ...state,
    TILED: {
      kind: "TILED",
      availability: "available",
      imageUrl,
    },
  };
}
