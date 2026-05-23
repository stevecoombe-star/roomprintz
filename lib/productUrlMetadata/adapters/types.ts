export type ProductMetadataResultCandidate = {
  title: string | null;
  previewImageUrl: string | null;
  priceRawText: string | null;
  priceNormalizedText: string | null;
  priceSource: string | null;
};

export type DomainAdapterMatchContext = {
  host: string;
  normalizedHost: string;
  sourceUrl: string;
};

export type DomainAdapterExtractContext = {
  sourceUrl: string;
  resolvedUrl: string;
  html: string;
  current: ProductMetadataResultCandidate;
  includePrice: boolean;
};

export type DomainAdapterExtractResult = {
  title?: string | null;
  previewImageUrl?: string | null;
  priceRawText?: string | null;
  priceNormalizedText?: string | null;
  priceSource?: string | null;
};

export type DomainAdapter = {
  id: string;
  domains: string[];
  matches?: (ctx: DomainAdapterMatchContext) => boolean;
  extract?: (ctx: DomainAdapterExtractContext) => Promise<DomainAdapterExtractResult> | DomainAdapterExtractResult;
};
