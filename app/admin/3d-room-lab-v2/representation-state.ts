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
  ORIGINAL: "The source room image.",
  EMPTY: "Future appearance-cleared evidence. No geometry is provided in V2-S1.",
  FULLY_TILED:
    "Future architectural observation evidence. No geometry is provided in V2-S1.",
};

export type OriginalImageSource = {
  type: "local-file";
  fileName: string;
  mimeType: string;
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
      reason: "EMPTY generation is not implemented in V2-S1.",
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
  };
}
