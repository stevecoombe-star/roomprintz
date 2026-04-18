const SUPPLIER_MAP: Record<string, string> = {
  "wayfair.ca": "Wayfair",
  "wayfair.com": "Wayfair",
  "ikea.com": "IKEA",
  "amazon.ca": "Amazon",
  "amazon.com": "Amazon",
  "article.com": "Article",
};

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function normalizeSupplier(domain: string | null): string | null {
  if (!domain) return null;
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) return null;
  if (SUPPLIER_MAP[normalizedDomain]) return SUPPLIER_MAP[normalizedDomain];

  const base = normalizedDomain.split(".")[0];
  return base ? capitalize(base) : null;
}
