"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  PARTNER_ADD_PRODUCT_CURRENCIES,
  PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT,
  PARTNER_ADD_PRODUCT_STEPS,
  buildPartnerProductCreate,
  diffPartnerAddProductMutations,
  discardPartnerAddProductMutation,
  emptyPartnerAddProductFields,
  identifyCreatedPartnerProduct,
  partnerAddProductCollectionChoices,
  partnerAddProductFieldsMatch,
  partnerAddProductIssueStep,
  partnerAddProductOtherSkus,
  partnerAddProductPublishLabel,
  partnerProductNeedsShortName,
  partnerVariantNeedsShortName,
  readPartnerAddProductFields,
  readPartnerAddProductResume,
  summarizePartnerAddProduct,
  validatePartnerAddProductStep,
  type PartnerAddProductCurrencyChoice,
  type PartnerAddProductFields,
  type PartnerAddProductMutation,
  type PartnerAddProductStep,
} from "@/lib/vibode-stage/partner-add-product";
import type { PartnerCommercialAssetOption } from "@/lib/vibode-stage/partner-commercial-assets";
import { presentPartnerDraftPreview } from "@/lib/vibode-stage/partner-draft-preview-view";
import { partnerCatalogEditorPath } from "@/lib/vibode-stage/partner-catalog-workspace";
import {
  PARTNER_PUBLISH_CONFIRMATION,
  describePartnerProductReview,
  describePartnerPublishInclusions,
  partnerEditorAssetLabel,
  partnerEditorAssetOptionLabel,
  partnerEditorErrorMessage,
  partnerPublishConfirmation,
  partnerVariantHeading,
  presentPartnerVariantModel,
  readPartnerEditorDraftResponse,
  type PartnerEditorDraft,
  type PartnerProductReview,
} from "@/lib/vibode-stage/partner-product-editor";
import type { StageAsset, StageCategory, StageCollection, StageProduct, StageVariant } from "@/lib/vibode-stage/types";

import { FIELD, PRIMARY, SECONDARY } from "../products/editor-ui";
import { PartnerInlineModelPanel } from "../products/PartnerInlineModelPanel";
import { PartnerSaveState, type PartnerSaveStateValue } from "../products/PartnerSaveState";
import { usePartnerInlineGlbUploads } from "../products/usePartnerInlineGlbUploads";

const MODEL_COPY = "Upload a GLB so customers can place this Product in their room.";
const CATALOG_PATH = "/partner/catalog";

type SavedProduct = Readonly<{
  productId: string;
  variantId: string;
  fields: PartnerAddProductFields;
}>;

function fileNameFor(
  assetId: string,
  options: readonly PartnerCommercialAssetOption[],
): string | null {
  return options.find((option) => option.assetId === assetId)?.originalFileName?.trim() || null;
}

function withFileName(
  fields: PartnerAddProductFields,
  options: readonly PartnerCommercialAssetOption[],
): PartnerAddProductFields {
  if (fields.assetFileName) return fields;
  return { ...fields, assetFileName: fileNameFor(fields.assetId, options) };
}

function formStarted(fields: PartnerAddProductFields, inheritedCurrency: string): boolean {
  return Boolean(
    fields.name.trim()
    || fields.price.trim()
    || fields.imageUrl.trim()
    || fields.productUrl.trim()
    || fields.categoryId
    || fields.finish.trim()
    || fields.sku.trim()
    || fields.assetId
    || fields.collectionIds.length > 0
    || (fields.currency && fields.currency !== inheritedCurrency),
  );
}

export function PartnerAddProductFlow(props: Readonly<{
  partnerId: string;
  currency: PartnerAddProductCurrencyChoice;
  categories: readonly StageCategory[];
  collections: readonly StageCollection[];
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  assets: readonly StageAsset[];
  commercialAssetOptions: readonly PartnerCommercialAssetOption[];
  draft: PartnerEditorDraft | null;
  initialStep?: PartnerAddProductStep;
}>) {
  const inheritedCurrency = props.currency.mode === "inherited" ? props.currency.currency : "";
  const initialResume = useRef(readPartnerAddProductResume(props.draft?.document ?? null));
  const [step, setStep] = useState<PartnerAddProductStep>(() => (
    props.initialStep
    ?? (initialResume.current.kind === "one" && initialResume.current.fields.assetId ? "review" : "product")
  ));
  const [fields, setFields] = useState<PartnerAddProductFields>(() => {
    if (initialResume.current.kind !== "one") return emptyPartnerAddProductFields(inheritedCurrency);
    return withFileName(initialResume.current.fields, props.commercialAssetOptions);
  });
  const [saved, setSaved] = useState<SavedProduct | null>(() => {
    if (initialResume.current.kind !== "one") return null;
    const next = withFileName(initialResume.current.fields, props.commercialAssetOptions);
    return {
      productId: initialResume.current.productId,
      variantId: initialResume.current.variantId,
      fields: next,
    };
  });
  const [draft, setDraft] = useState(props.draft);
  const [busy, setBusy] = useState<null | "save" | "publish">(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<PartnerProductReview | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState<number | null>(null);
  const draftRef = useRef(draft);
  const fieldsRef = useRef(fields);
  const savedRef = useRef(saved);
  const reviewToken = useRef(0);
  const persistQueue = useRef(Promise.resolve());
  const uploads = usePartnerInlineGlbUploads();
  draftRef.current = draft;
  fieldsRef.current = fields;
  savedRef.current = saved;

  function updateFields(patch: Partial<PartnerAddProductFields>) {
    const next = { ...fieldsRef.current, ...patch };
    fieldsRef.current = next;
    setFields(next);
    return next;
  }

  const modelOptions = useMemo(() => props.commercialAssetOptions.map((option) => ({
    assetId: option.assetId,
    label: partnerEditorAssetOptionLabel(option),
  })), [props.commercialAssetOptions]);
  const productNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const product of props.products) names[product.productId] = product.name;
    for (const create of draft?.document.products.create ?? []) names[create.productId] = create.name;
    return names;
  }, [draft?.document.products.create, props.products]);
  const variantProductIds = useMemo(() => {
    const ids: Record<string, string> = {};
    for (const variant of props.variants) ids[variant.variantId] = variant.productId;
    for (const create of draft?.document.variants.create ?? []) ids[create.variantId] = create.productId;
    return ids;
  }, [draft?.document.variants.create, props.variants]);

  const draftInclusions = describePartnerPublishInclusions({
    document: draft?.document ?? null,
    productId: saved?.productId ?? "__pending_product__",
    productNames,
    variantProductIds,
  });
  const reviewCurrent = review != null && reviewedRevision === draft?.revision;
  const otherLines = reviewCurrent && review ? review.otherLines : draftInclusions;
  const reviewIssues = reviewCurrent && review ? review.issues : [];
  const dirty = saved
    ? !partnerAddProductFieldsMatch(fields, saved.fields)
    : formStarted(fields, inheritedCurrency);
  const saveState: PartnerSaveStateValue | null = busy === "save"
    ? "saving"
    : saveFailed
      ? "failed"
      : dirty
        ? "unsaved"
        : saved
          ? "saved"
          : null;
  const locked = busy != null || conflict || uploads.anyBusy();
  const canPublish = Boolean(
    reviewCurrent
    && review?.publishable
    && !conflict
    && busy == null
    && !uploads.anyBusy()
    && saved,
  );

  function assetReady(next: PartnerAddProductFields): boolean {
    if (!next.assetId.trim()) return false;
    if (props.commercialAssetOptions.some((option) => option.assetId === next.assetId)) return true;
    return Boolean(next.assetFileName);
  }

  function validationInput(nextStep: "product" | "variant" | "model", next = fieldsRef.current) {
    const document = draftRef.current?.document ?? null;
    const ignoreProductId = savedRef.current?.productId ?? null;
    const ignoreVariantId = savedRef.current?.variantId ?? null;
    const pendingVariants = (document?.variants.create ?? []).filter((item) => item.variantId !== ignoreVariantId);
    return {
      step: nextStep,
      fields: next,
      currencyMode: props.currency.mode,
      categories: props.categories,
      partnerId: props.partnerId,
      products: props.products,
      variants: props.variants,
      pendingProductIds: (document?.products.create ?? [])
        .map((item) => item.productId)
        .filter((id) => id !== ignoreProductId),
      pendingVariantIds: pendingVariants.map((item) => item.variantId),
      pendingSkus: partnerAddProductOtherSkus({
        variants: props.variants,
        pendingVariants,
        ignoreVariantId,
      }),
      ignoreProductId,
      ignoreVariantId,
      assetReady: assetReady(next),
    };
  }

  function adoptSaved(nextDraft: PartnerEditorDraft, productId: string, fileName: string | null) {
    const read = readPartnerAddProductFields(nextDraft.document, productId);
    if (!read) return;
    const nextFields = {
      ...read.fields,
      assetFileName: fileName ?? fileNameFor(read.fields.assetId, props.commercialAssetOptions),
    };
    const savedProduct = { productId, variantId: read.variantId, fields: nextFields };
    savedRef.current = savedProduct;
    fieldsRef.current = nextFields;
    setSaved(savedProduct);
    setFields(nextFields);
  }

  async function ensureDraft(): Promise<PartnerEditorDraft | null> {
    if (draftRef.current) return draftRef.current;
    const response = await fetch("/api/vibode/partner/drafts", { method: "POST" });
    const body = await response.json() as { error?: string; draft?: unknown };
    const next = readPartnerEditorDraftResponse(body.draft);
    if (!response.ok || !next) {
      setSaveFailed(true);
      setError(partnerEditorErrorMessage(body.error));
      return null;
    }
    draftRef.current = next;
    setDraft(next);
    return next;
  }

  async function sendMutations(
    mutations: readonly PartnerAddProductMutation[],
  ): Promise<PartnerEditorDraft | null> {
    if (conflict || mutations.length === 0) return draftRef.current;
    setBusy("save");
    setSaveFailed(false);
    setError(null);
    setReview(null);
    setReviewedRevision(null);
    try {
      const current = await ensureDraft();
      if (!current) return null;
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision, mutations }),
      });
      const body = await response.json() as { error?: string; draft?: unknown };
      if (response.status === 409) {
        setConflict(true);
        setSaveFailed(true);
        setError("These details were updated elsewhere. Reload this page and try again.");
        return null;
      }
      const next = readPartnerEditorDraftResponse(body.draft);
      if (!response.ok || !next) {
        setSaveFailed(true);
        setError(partnerEditorErrorMessage(body.error));
        return null;
      }
      draftRef.current = next;
      setDraft(next);
      setSaveFailed(false);
      return next;
    } catch {
      setSaveFailed(true);
      setError("The change could not be saved.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function persistFields(next: PartnerAddProductFields): Promise<boolean> {
    const run = persistQueue.current.then(() => writeFields(next));
    persistQueue.current = run.then(() => undefined, () => undefined);
    return run;
  }

  async function writeFields(next: PartnerAddProductFields): Promise<boolean> {
    fieldsRef.current = next;
    setFields(next);
    const currentSaved = savedRef.current;
    if (!currentSaved) {
      const built = buildPartnerProductCreate(validationInput("model", next));
      if (!built.ok) {
        setIssues(built.issues);
        setStep(partnerAddProductIssueStep(built.issues[0] ?? "") ?? "product");
        return false;
      }
      const previousIds = (draftRef.current?.document.products.create ?? []).map((item) => item.productId);
      const savedDraft = await sendMutations([built.mutation]);
      if (!savedDraft) return false;
      const created = identifyCreatedPartnerProduct(previousIds, savedDraft.document);
      if (!created) {
        setSaveFailed(true);
        setError("The product could not be saved.");
        return false;
      }
      adoptSaved(savedDraft, created.productId, next.assetFileName);
      setIssues([]);
      return true;
    }
    const mutations = diffPartnerAddProductMutations({
      productId: currentSaved.productId,
      variantId: currentSaved.variantId,
      saved: currentSaved.fields,
      next,
    });
    if (mutations.length === 0) return true;
    const savedDraft = await sendMutations(mutations);
    if (!savedDraft) return false;
    adoptSaved(savedDraft, currentSaved.productId, next.assetFileName);
    setIssues([]);
    return true;
  }

  async function flushSavedEdits(scope: "product" | "variant" | "model"): Promise<boolean> {
    if (!savedRef.current) return true;
    const found = validatePartnerAddProductStep(validationInput(scope));
    if (found.length > 0) {
      setIssues(found);
      return false;
    }
    return persistFields(fieldsRef.current);
  }

  function rememberModel(assetId: string, fileName: string | null) {
    const next = { ...fieldsRef.current, assetId, assetFileName: fileName };
    fieldsRef.current = next;
    setFields(next);
    setIssues([]);
    if (!assetReady(next)) return;
    const readyIssues = [
      ...validatePartnerAddProductStep(validationInput("product", next)),
      ...validatePartnerAddProductStep(validationInput("variant", next)),
    ];
    if (readyIssues.length > 0) {
      setIssues(readyIssues);
      return;
    }
    void persistFields(next);
  }

  async function uploadModel(file: File) {
    if (locked) return;
    const outcome = await uploads.run("create", file);
    if (outcome.status !== "ready" || !uploads.isCurrent("create", outcome.token)) return;
    uploads.remember(outcome.assetId, outcome.fileName);
    uploads.settle("create");
    rememberModel(outcome.assetId, outcome.fileName);
  }

  function chooseModel(assetId: string) {
    const option = props.commercialAssetOptions.find((item) => item.assetId === assetId);
    if (!option) return;
    uploads.settle("create");
    rememberModel(option.assetId, option.originalFileName);
  }

  async function continueStep() {
    if (step === "review" || step === "model") {
      if (step === "model") await openReview();
      return;
    }
    const found = validatePartnerAddProductStep(validationInput(step));
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    setIssues([]);
    if (savedRef.current) {
      const savedOk = await flushSavedEdits(step);
      if (!savedOk) return;
    }
    setStep(step === "product" ? "variant" : "model");
  }

  async function openReview() {
    const found = [
      ...validatePartnerAddProductStep(validationInput("product")),
      ...validatePartnerAddProductStep(validationInput("variant")),
      ...validatePartnerAddProductStep(validationInput("model")),
    ];
    if (found.length > 0) {
      setIssues(found);
      setStep(partnerAddProductIssueStep(found[0] ?? "") ?? "product");
      return;
    }
    const ok = await persistFields(fieldsRef.current);
    if (!ok) return;
    setStep("review");
  }

  async function runReview(current: PartnerEditorDraft) {
    const product = savedRef.current;
    if (!product) return;
    const token = reviewToken.current + 1;
    reviewToken.current = token;
    setError(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      const body: unknown = await response.json();
      if (reviewToken.current !== token) return;
      const presented = presentPartnerDraftPreview(body);
      const variantLabels: Record<string, string> = {};
      variantLabels[product.variantId] = partnerVariantHeading(
        fieldsRef.current.finish || null,
        fieldsRef.current.sku || null,
      );
      const collectionNames: Record<string, string> = {};
      for (const collection of props.collections) collectionNames[collection.collectionId] = collection.name;
      for (const create of current.document.collections.create ?? []) collectionNames[create.collectionId] = create.name;
      setReview(describePartnerProductReview(presented, {
        productId: product.productId,
        productNames,
        variantLabels,
        collectionNames,
        variantProductIds,
        assetLabel: (assetId: string) => {
          const label = partnerEditorAssetLabel(props.commercialAssetOptions, assetId);
          if (label !== "Ready") return label;
          const fileName = fieldsRef.current.assetId === assetId ? fieldsRef.current.assetFileName : null;
          return fileName ? `${fileName} · Ready` : label;
        },
      }));
      setReviewedRevision(current.revision);
    } catch {
      if (reviewToken.current !== token) return;
      setReview({
        publishable: false,
        issues: ["Changes could not be reviewed. Try again."],
        changes: [],
        otherLines: [],
      });
      setReviewedRevision(current.revision);
    }
  }

  useEffect(() => {
    if (step !== "review") return;
    const current = draftRef.current;
    if (!current || !savedRef.current) return;
    void runReview(current);
    // Preview runs when this step is opened, including after a later edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function publish() {
    const current = draftRef.current;
    if (!current || !canPublish || conflict) return;
    const confirmed = window.confirm(partnerPublishConfirmation(otherLines, 1));
    if (!confirmed) return;
    setBusy("publish");
    setError(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedDraftRevision: current.revision }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; code?: string };
      if (response.status === 409) {
        setReview(null);
        setReviewedRevision(null);
        setError("The live catalog changed. Reload this page and review again before publishing.");
        return;
      }
      if (response.status === 400) {
        setError("These details need attention before they can be published.");
        await runReview(current);
        return;
      }
      if (!response.ok || body.ok !== true) {
        setError(partnerEditorErrorMessage(body.error));
        return;
      }
      window.location.assign(CATALOG_PATH);
    } catch {
      setError("The changes could not be published.");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    const product = savedRef.current;
    if (!product) {
      window.location.assign(CATALOG_PATH);
      return;
    }
    const confirmed = window.confirm(
      "Discard this new product? Other unpublished catalog changes stay in place.",
    );
    if (!confirmed) return;
    const savedDraft = await sendMutations([discardPartnerAddProductMutation(product.productId)]);
    if (!savedDraft) return;
    window.location.assign(CATALOG_PATH);
  }

  const summary = summarizePartnerAddProduct({ fields, categories: props.categories });
  const collectionChoices = partnerAddProductCollectionChoices({
    partnerId: props.partnerId,
    collections: props.collections,
    pendingCollections: (draft?.document.collections.create ?? []).map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
    })),
    selectedIds: fields.collectionIds,
  });
  const selectedCategory = props.categories.find((category) => category.id === fields.categoryId) ?? null;
  const showCurrencySelect = props.currency.mode === "choose" && !saved;
  const currencyLabel = saved?.fields.currency || inheritedCurrency || fields.currency;
  const modelPresentation = fields.assetId
    ? presentPartnerVariantModel({
      assetId: fields.assetId,
      assets: props.assets,
      options: props.commercialAssetOptions,
      published: false,
      uploadedFileName: fields.assetFileName,
    })
    : null;
  const currentIndex = PARTNER_ADD_PRODUCT_STEPS.findIndex((item) => item.id === step);
  const visibleIssues = step === "review" ? reviewIssues : issues;

  if (props.currency.mode === "conflict") {
    return (
      <section className="max-w-xl space-y-4 rounded-xl border border-slate-800 p-5">
        <p className="text-sm text-slate-200">{PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT}</p>
        <div className="flex flex-wrap gap-2">
          <a href={CATALOG_PATH} className={SECONDARY}>Cancel</a>
          {initialResume.current.kind === "one" ? (
            <button type="button" className={SECONDARY} disabled={locked} onClick={() => void discard()}>
              Discard new product
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (initialResume.current.kind === "unavailable") {
    return (
      <section className="max-w-xl space-y-4">
        <p className="text-sm text-slate-300">
          An unpublished product is already saved and can’t be continued here.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={CATALOG_PATH} className={SECONDARY}>Cancel</a>
          {props.draft ? (
            <a href={partnerCatalogEditorPath(props.draft.draftId, "manage")} className={PRIMARY}>
              Continue editing
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol aria-label="Product creation" className="flex flex-wrap gap-2 text-xs">
          {PARTNER_ADD_PRODUCT_STEPS.map((item, index) => (
            <li key={item.id}>
              {index < currentIndex ? (
                <button
                  type="button"
                  className="rounded-full border border-slate-700 px-2.5 py-1 text-slate-300"
                  onClick={() => {
                    setIssues([]);
                    setStep(item.id);
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <span
                  className={index === currentIndex
                    ? "rounded-full border border-slate-500 px-2.5 py-1 text-slate-100"
                    : "rounded-full border border-slate-800 px-2.5 py-1 text-slate-500"}
                  aria-current={index === currentIndex ? "step" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
        <PartnerSaveState state={saveState} />
      </div>

      {initialResume.current.kind === "many" && step === "product" ? (
        <p className="text-sm text-amber-100">
          You already have unpublished new products. This starts another product. Publishing includes those products too.
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-rose-200">{error}</p> : null}
      {visibleIssues.length > 0 ? (
        <div role="alert" className="space-y-1">
          {visibleIssues.map((issue) => (
            <p key={issue} className="text-sm text-rose-200">{issue}</p>
          ))}
        </div>
      ) : null}

      {step === "product" ? (
        <section aria-labelledby="add-product-step" className="space-y-4">
          <h2 id="add-product-step" className="text-lg font-medium">Product</h2>
          <label className="block text-xs text-slate-400">
            Product name
            <input
              className={FIELD}
              value={fields.name}
              disabled={locked}
              onChange={(event) => updateFields({ name: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
            />
          </label>
          {partnerProductNeedsShortName(fields.name) && !saved ? (
            <label className="block text-xs text-slate-400">
              Short name
              <input
                className={FIELD}
                value={fields.productShortName}
                disabled={locked}
                onChange={(event) => updateFields({ productShortName: event.target.value })}
              />
            </label>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block text-xs text-slate-400">
              Price
              <input
                className={FIELD}
                inputMode="decimal"
                value={fields.price}
                disabled={locked}
                onChange={(event) => updateFields({ price: event.target.value })}
                onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
              />
            </label>
            {showCurrencySelect ? (
              <label className="block text-xs text-slate-400">
                Currency
                <select
                  className={FIELD}
                  value={fields.currency}
                  disabled={locked}
                  onChange={(event) => updateFields({ currency: event.target.value })}
                >
                  <option value="">Choose</option>
                  {PARTNER_ADD_PRODUCT_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
            ) : currencyLabel ? (
              <p className="self-end pb-2 text-sm text-slate-200">{currencyLabel}</p>
            ) : null}
          </div>
          <label className="block text-xs text-slate-400">
            Product image URL
            <input
              className={FIELD}
              value={fields.imageUrl}
              disabled={locked}
              onChange={(event) => updateFields({ imageUrl: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Product page URL
            <input
              className={FIELD}
              value={fields.productUrl}
              disabled={locked}
              onChange={(event) => updateFields({ productUrl: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Category
              <select
                className={FIELD}
                value={fields.categoryId}
                disabled={locked}
                onChange={(event) => updateFields({
                  categoryId: event.target.value,
                  subcategoryId: "",
                })}
                onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
              >
                <option value="">Choose</option>
                {props.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            {selectedCategory && selectedCategory.subcategories.length > 0 ? (
              <label className="block text-xs text-slate-400">
                Subcategory
                <select
                  className={FIELD}
                  value={fields.subcategoryId}
                  disabled={locked}
                  onChange={(event) => updateFields({ subcategoryId: event.target.value })}
                  onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
                >
                  <option value="">None</option>
                  {selectedCategory.subcategories.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.id}>{subcategory.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {collectionChoices.length > 0 ? (
            <fieldset className="space-y-2" disabled={locked}>
              <legend className="text-xs text-slate-400">Collections</legend>
              {collectionChoices.map((collection) => (
                <label key={collection.name} className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={collection.checked}
                    onChange={(event) => {
                      const nextIds = event.target.checked
                        ? [...fieldsRef.current.collectionIds, collection.collectionId]
                        : fieldsRef.current.collectionIds.filter((id) => id !== collection.collectionId);
                      updateFields({ collectionIds: nextIds });
                    }}
                    onBlur={() => { if (savedRef.current) void flushSavedEdits("product"); }}
                  />
                  <span>{collection.name}</span>
                  {collection.pending ? <span className="text-xs text-slate-400">Not published yet</span> : null}
                </label>
              ))}
            </fieldset>
          ) : null}
        </section>
      ) : null}

      {step === "variant" ? (
        <section aria-labelledby="add-variant-step" className="space-y-4">
          <h2 id="add-variant-step" className="text-lg font-medium">Variant</h2>
          <p className="text-sm text-slate-400">
            This finish uses the product price{currencyLabel ? ` (${currencyLabel})` : ""}.
          </p>
          <label className="block text-xs text-slate-400">
            Finish
            <input
              className={FIELD}
              value={fields.finish}
              disabled={locked}
              onChange={(event) => updateFields({ finish: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("variant"); }}
            />
          </label>
          {partnerVariantNeedsShortName(fields.finish) && !saved ? (
            <label className="block text-xs text-slate-400">
              Short name
              <input
                className={FIELD}
                value={fields.variantShortName}
                disabled={locked}
                onChange={(event) => updateFields({ variantShortName: event.target.value })}
              />
            </label>
          ) : null}
          <label className="block text-xs text-slate-400">
            SKU
            <input
              className={FIELD}
              value={fields.sku}
              disabled={locked}
              onChange={(event) => updateFields({ sku: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("variant"); }}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Variant page URL
            <input
              className={FIELD}
              value={fields.variantProductUrl}
              disabled={locked}
              placeholder="Optional"
              onChange={(event) => updateFields({ variantProductUrl: event.target.value })}
              onBlur={() => { if (savedRef.current) void flushSavedEdits("variant"); }}
            />
          </label>
        </section>
      ) : null}

      {step === "model" ? (
        <section aria-labelledby="add-model-step" className="space-y-4">
          <h2 id="add-model-step" className="text-lg font-medium">3D Model</h2>
          <PartnerInlineModelPanel
            saved={modelPresentation}
            upload={uploads.view("create")}
            options={modelOptions}
            selectedAssetId={fields.assetId}
            disabled={locked}
            invalid={Boolean(fields.assetId) && !assetReady(fields)}
            emptyDetail={MODEL_COPY}
            showSectionLabel={false}
            onFile={(file) => void uploadModel(file)}
            onChoose={chooseModel}
          />
        </section>
      ) : null}

      {step === "review" ? (
        <section aria-labelledby="add-review-step" className="space-y-5">
          <h2 id="add-review-step" className="text-lg font-medium">Review & Publish</h2>
          <div className="space-y-4 rounded-xl border border-slate-800 p-4">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500">Product</h3>
              <p className="mt-1 text-sm text-slate-100">{summary.productName}</p>
              {summary.priceLabel ? <p className="text-sm text-slate-300">{summary.priceLabel}</p> : null}
              {summary.categoryLabel ? (
                <p className="text-sm text-slate-300">
                  {summary.subcategoryLabel
                    ? `${summary.categoryLabel} · ${summary.subcategoryLabel}`
                    : summary.categoryLabel}
                </p>
              ) : null}
              {collectionChoices.some((collection) => collection.checked) ? (
                <p className="text-sm text-slate-400">
                  {collectionChoices.filter((collection) => collection.checked).map((collection) => collection.name).join(", ")}
                </p>
              ) : null}
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500">Variant</h3>
              <p className="mt-1 text-sm text-slate-100">{summary.finish}</p>
              {summary.sku ? <p className="text-sm text-slate-300">SKU: {summary.sku}</p> : null}
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500">3D Model</h3>
              <p className="mt-1 text-sm text-slate-100">{summary.modelLabel}</p>
              {summary.modelFileName ? <p className="text-sm text-slate-300">{summary.modelFileName}</p> : null}
            </div>
          </div>
          {otherLines.length > 0 ? (
            <div className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-3">
              <h3 className="text-sm font-medium text-amber-50">Also included in this publish</h3>
              <ul className="mt-2 space-y-1 text-sm text-amber-100">
                {otherLines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ) : null}
          {!reviewCurrent ? <p className="text-sm text-slate-400">Checking these details…</p> : null}
          <p className="text-sm text-slate-400">{PARTNER_PUBLISH_CONFIRMATION}</p>
          <button type="button" className={PRIMARY} disabled={!canPublish} onClick={() => void publish()}>
            {busy === "publish" ? "Publishing…" : partnerAddProductPublishLabel(otherLines.length)}
          </button>
          {visibleIssues.length > 0 ? (
            <button
              type="button"
              className={SECONDARY}
              onClick={() => setStep(partnerAddProductIssueStep(visibleIssues[0] ?? "") ?? "product")}
            >
              {partnerAddProductIssueStep(visibleIssues[0] ?? "") === "variant"
                ? "Edit variant"
                : partnerAddProductIssueStep(visibleIssues[0] ?? "") === "model"
                  ? "Edit 3D model"
                  : "Edit product"}
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step !== "product" ? (
          <button
            type="button"
            className={SECONDARY}
            disabled={locked}
            onClick={() => {
              const previous = PARTNER_ADD_PRODUCT_STEPS[currentIndex - 1];
              if (!previous) return;
              setIssues([]);
              setStep(previous.id);
            }}
          >
            Back
          </button>
        ) : null}
        {step !== "review" ? (
          <button type="button" className={PRIMARY} disabled={locked} onClick={continueStep}>
            {step === "model" ? "Review" : "Continue"}
          </button>
        ) : null}
        {saved ? (
          <button type="button" className={SECONDARY} disabled={locked} onClick={() => void discard()}>
            Discard new product
          </button>
        ) : (
          <a href={CATALOG_PATH} className={SECONDARY}>Cancel</a>
        )}
      </div>
    </div>
  );
}
