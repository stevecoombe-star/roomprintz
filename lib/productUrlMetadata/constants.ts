export const PRODUCT_PAGE_FETCH_TIMEOUT_MS = 6000;
export const PRODUCT_PAGE_MAX_HTML_CHARS = 750_000;
export const PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS = 2_000;

export const METADATA_FETCH_PROFILES: Array<{ id: string; headers: Record<string, string> }> = [
  {
    id: "browser_like",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
    },
  },
  {
    id: "legacy_roomprintzbot",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; VibodeBot/1.0; +https://www.vibode.com)",
      Accept: "text/html,application/xhtml+xml",
    },
  },
];

export const TRACKING_QUERY_PARAM_PREFIXES = ["utm_", "mtm_", "pk_"];
export const TRACKING_QUERY_PARAM_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "igshid",
  "srsltid",
  "ref",
  "ref_",
  "refid",
  "source",
  "sourceid",
  "campaign",
  "campaignid",
]);
