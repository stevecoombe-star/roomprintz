export type MetadataFetchAttemptRecord = {
  inputUrl: string;
  fetchProfile: string;
  status: number | null;
  ok: boolean;
  contentType: string | null;
  resolvedUrl: string | null;
  errorCode: string | null;
};

export type MetadataExtractionDiagnostics = {
  attempts: MetadataFetchAttemptRecord[];
  htmlLength: number | null;
  htmlSubstantial: boolean | null;
  jsonLdBlockCount: number;
  jsonLdCandidateFound: boolean;
  metaTagCandidateFound: boolean;
  scriptEmbeddedCandidateFound: boolean;
  visibleHtmlCandidateFound: boolean;
  selectedPriceSource: string | null;
  selectedAdapterId: string | null;
};

export type ProductUrlMetadataResult = {
  normalizedSourceUrl: string | null;
  resolvedUrl: string | null;
  finalDomain: string | null;
  title: string | null;
  previewImageUrl: string | null;
  priceRawText: string | null;
  priceNormalizedText: string | null;
  priceSource: string | null;
  fetchOk: boolean;
  blockedReason: string | null;
  diagnostics: MetadataExtractionDiagnostics;
};

export type ProductUrlMetadataResolveArgs = {
  sourceUrl: string;
  includePrice: boolean;
  mode: "preview" | "save";
  requestId: string;
  logEvent?: (
    level: "info" | "warn" | "error",
    event: string,
    fields?: Record<string, unknown>
  ) => void;
};
