import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTempleAndWebsterSku,
  templeAndWebsterAdapter,
} from "@/lib/productUrlMetadata/adapters/templeAndWebster";

const SAMPLE_PRODUCT_URL =
  "https://www.templeandwebster.com.au/Tan-Stockholm-3-Seater-Faux-Leather-Sofa-TMPL2419.html";

// Fixture HTML for parser behavior tests only. This does not exercise live network fetches.
const SAMPLE_PRODUCT_HTML = `
<!doctype html>
<html>
  <head>
    <title>Tan Stockholm 3 Seater Faux Leather Sofa - Temple & Webster</title>
  </head>
  <body>
    <nav>Furniture > Living Room Furniture > Sofas > TMPL2419</nav>
    <h1>Tan Stockholm 3 Seater Faux Leather Sofa</h1>
    <p>SKU #: TMPL2419</p>
    <div class="payment">4 payments of $199.75</div>
    <div class="price">$799</div>
    <img src="https://www.templeandwebster.com.au/assets/payment/afterpay-badge.png" alt="Afterpay" />
    <img
      src="https://www.templeandwebster.com.au/media/products/tmpl2419-main.jpg"
      alt="Tan Stockholm 3 Seater Faux Leather Sofa"
    />
  </body>
</html>
`;

test("templeAndWebster adapter matches product URLs", () => {
  const doesMatch = templeAndWebsterAdapter.matches?.({
    host: "www.templeandwebster.com.au",
    normalizedHost: "templeandwebster.com.au",
    sourceUrl: SAMPLE_PRODUCT_URL,
  });
  assert.equal(doesMatch, true);
});

test("templeAndWebster adapter does not match non-product URLs", () => {
  const doesMatch = templeAndWebsterAdapter.matches?.({
    host: "www.templeandwebster.com.au",
    normalizedHost: "templeandwebster.com.au",
    sourceUrl: "https://www.templeandwebster.com.au/search?query=sofa",
  });
  assert.equal(doesMatch, false);
});

test("templeAndWebster adapter extracts expected metadata from fixture HTML", async () => {
  const extracted = await templeAndWebsterAdapter.extract?.({
    sourceUrl: SAMPLE_PRODUCT_URL,
    resolvedUrl: SAMPLE_PRODUCT_URL,
    html: SAMPLE_PRODUCT_HTML,
    current: {
      title: null,
      previewImageUrl: null,
      priceRawText: null,
      priceNormalizedText: null,
      priceSource: null,
    },
    includePrice: true,
  });

  assert.ok(extracted);
  assert.equal(extracted?.title, "Tan Stockholm 3 Seater Faux Leather Sofa");
  assert.equal(extractTempleAndWebsterSku(SAMPLE_PRODUCT_HTML, SAMPLE_PRODUCT_URL), "TMPL2419");
  assert.equal(templeAndWebsterAdapter.id, "templeandwebster");
  assert.deepEqual(templeAndWebsterAdapter.domains, ["templeandwebster.com.au"]);
  assert.equal(
    extracted?.previewImageUrl,
    "https://www.templeandwebster.com.au/media/products/tmpl2419-main.jpg"
  );
});
