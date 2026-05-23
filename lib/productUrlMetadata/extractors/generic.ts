import { getMetaContent, getTitleFromHtml } from "@/lib/productUrlMetadata/html";
import { asHttpUrl } from "@/lib/productUrlMetadata/url";

export type GenericMetadataExtraction = {
  title: string | null;
  previewImageUrl: string | null;
};

export function extractGenericMetadata(html: string, resolvedUrl: string): GenericMetadataExtraction {
  const title = getTitleFromHtml(html);
  const previewImageCandidate =
    getMetaContent(html, [{ key: "property", value: "og:image" }]) ??
    getMetaContent(html, [{ key: "name", value: "twitter:image" }]) ??
    getMetaContent(html, [
      { key: "property", value: "og:image:url" },
      { key: "name", value: "twitter:image:src" },
      { key: "itemprop", value: "image" },
    ]);
  const previewImageUrl = asHttpUrl(previewImageCandidate, resolvedUrl);
  return {
    title,
    previewImageUrl,
  };
}
