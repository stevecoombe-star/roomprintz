import type {
  DomainAdapter,
  DomainAdapterExtractResult,
} from "@/lib/productUrlMetadata/adapters/types";
import { normalizeHost } from "@/lib/productUrlMetadata/url";

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function createNoopAdapter(id: string, domains: string[]): DomainAdapter {
  return {
    id,
    domains,
    extract: (): DomainAdapterExtractResult => ({}),
  };
}

const ADAPTERS: DomainAdapter[] = [
  createNoopAdapter("crateandbarrel", ["crateandbarrel.com", "crateandbarrel.ca"]),
  createNoopAdapter("cb2", ["cb2.com", "cb2.ca"]),
];

export function resolveDomainAdaptersForHost(host: string | null): DomainAdapter[] {
  if (!host) return [];
  const normalized = normalizeHost(host);
  return ADAPTERS.filter((adapter) => {
    const matchedDomain = adapter.domains.some((domain) => hostMatchesDomain(normalized, normalizeHost(domain)));
    if (!matchedDomain) return false;
    if (!adapter.matches) return true;
    return adapter.matches({
      host,
      normalizedHost: normalized,
      sourceUrl: "",
    });
  });
}
