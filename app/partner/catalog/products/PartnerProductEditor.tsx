"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import type { PartnerCommercialAssetOption } from "@/lib/vibode-stage/partner-commercial-assets";
import { presentPartnerDraftPreview } from "@/lib/vibode-stage/partner-draft-preview-view";
import {
  PARTNER_MODEL_UPLOADED_NOT_ATTACHED,
  PARTNER_MODEL_UPLOADED_RELOAD,
  partnerInlineGlbModelStatusLabel,
  partnerUploadedModelAssociationFailure,
} from "@/lib/vibode-stage/partner-inline-glb-upload";
import {
  PARTNER_DISCARD_CONFIRMATION,
  PARTNER_PAGE_CHANGED,
  PARTNER_PUBLISH_FAILED,
  PARTNER_SAVE_FAILED,
  PARTNER_VARIANT_MODEL_REQUIRED,
  buildPartnerVariantCreate,
  collectionMembershipMutation,
  collectionProductIds,
  commitPartnerProductImage,
  commitPartnerProductName,
  commitPartnerProductPrice,
  commitPartnerProductUrl,
  commitPartnerVariantFinish,
  commitPartnerVariantModelDimensions,
  commitPartnerVariantPrice,
  commitPartnerVariantSku,
  commitPartnerVariantUrl,
  commitPendingVariantFinish,
  commitPendingVariantModel,
  commitPendingVariantModelDimensions,
  commitPendingVariantPrice,
  commitPendingVariantSku,
  commitPendingVariantUrl,
  describePartnerProductReview,
  describePartnerPublishInclusions,
  describeSavedPartnerProductChanges,
  partnerCategoryLabels,
  partnerEditorAssetLabel,
  partnerEditorAssetOptionLabel,
  partnerEditorCollectionChoices,
  partnerEditorDocumentHasChanges,
  partnerEditorErrorMessage,
  partnerEditorPendingProductStatus,
  partnerEditorPendingVariantStatus,
  partnerVariantStatusMutation,
  partnerProductStatusMutation,
  partnerPublishConfirmation,
  partnerVariantAssignedThumbnailUrl,
  partnerVariantHeading,
  presentPartnerVariantModel,
  readPartnerEditorDraftResponse,
  readPartnerProductFields,
  readPartnerVariantFields,
  readPendingVariantFields,
  removePendingVariantMutation,
  toggleProductInCollection,
  variantNeedsShortName,
  type PartnerEditorCommit,
  type PartnerEditorDraft,
  type PartnerEditorMutation,
  type PartnerEditorProductFields,
  type PartnerEditorVariantFields,
  type PartnerProductReview,
  type PartnerVariantModelPresentation,
} from "@/lib/vibode-stage/partner-product-editor";
import type { PartnerCatalogSyncDocument } from "@/lib/vibode-stage/partner-catalog-sync";
import {
  canonicalModelDimensions,
  explicitModelDimensions,
  modelDimensionsAfterAssetReplacement,
  modelSizeFromMeasured,
  nativeModelDimensions,
  type ModelDimensions,
  type ModelSize,
} from "@/lib/vibode-stage/model-dimensions";
import {
  PARTNER_VARIANT_ORDER_SAVED_EVENT,
  movePartnerVariant,
  orderPartnerVariantCards,
  partnerVariantManualIds,
  partnerVariantOrderLabel,
  samePartnerVariantOrder,
  type PartnerVariantSort,
} from "@/lib/vibode-stage/partner-variant-order";
import type { StageAsset, StageCategory, StageCollection, StageProduct, StageVariant } from "@/lib/vibode-stage/types";

import { FOCUS, safeHttpUrl, SECONDARY } from "./editor-ui";
import { PartnerInlineModelPanel } from "./PartnerInlineModelPanel";
import { PartnerModelDimensions } from "./PartnerModelDimensions";
import { PartnerVariantModelSummary, partnerVariantModelCardDetail } from "./PartnerModelSection";
import { PartnerProductFields } from "./PartnerProductFields";
import { PartnerPublishSection } from "./PartnerPublishSection";
import { PartnerSaveState, type PartnerSaveStateValue } from "./PartnerSaveState";
import { PartnerVariantFields } from "./PartnerVariantFields";
import { usePartnerInlineGlbUploads } from "./usePartnerInlineGlbUploads";

const PARTNER_EDITOR_CONFLICT = PARTNER_PAGE_CHANGED;
const PARTNER_EDITOR_CONFLICT_ALERT = PARTNER_PAGE_CHANGED;

type AddModelSelection = Readonly<{
  assetId: string;
  fileName: string | null;
  source: "upload" | "existing";
  native: ModelSize;
  dimensions: ModelDimensions;
}>;

function nativeForAsset(
  assetId: string | null,
  assets: readonly StageAsset[],
  options: readonly PartnerCommercialAssetOption[],
): ModelSize | null {
  if (!assetId) return null;
  const asset = assets.find((item) => item.assetId === assetId);
  if (asset) return nativeModelDimensions(asset);
  return nativeModelDimensions(options.find((item) => item.assetId === assetId) ?? null);
}

function savedVariantDimensions(
  variant: StageVariant,
  document: PartnerCatalogSyncDocument | null,
): ModelDimensions | null {
  const patch = document?.variants.update.find((item) => item.variantId === variant.variantId);
  return explicitModelDimensions({
    modelWidthM: patch?.modelWidthM ?? variant.modelWidthM,
    modelHeightM: patch?.modelHeightM ?? variant.modelHeightM,
    modelDepthM: patch?.modelDepthM ?? variant.modelDepthM,
    modelSizingMode: patch?.modelSizingMode ?? variant.modelSizingMode,
  });
}

function addModelSelection(
  assetId: string,
  fileName: string | null,
  source: AddModelSelection["source"],
  native: ModelSize,
  previous: AddModelSelection | null,
): AddModelSelection {
  const associated = modelDimensionsAfterAssetReplacement({
    previousExplicit: previous?.dimensions ?? null,
    nextNative: native,
  });
  return {
    assetId,
    fileName,
    source,
    native,
    dimensions: associated?.dimensions ?? { ...native, sizingMode: "uniform" },
  };
}

function variantFieldMap(
  productId: string,
  variants: readonly StageVariant[],
  document: PartnerCatalogSyncDocument | null,
): Record<string, PartnerEditorVariantFields> {
  const fields: Record<string, PartnerEditorVariantFields> = {};
  for (const variant of variants) {
    if (variant.productId !== productId) continue;
    fields[variant.variantId] = readPartnerVariantFields(variant, document);
  }
  for (const create of document?.variants.create ?? []) {
    if (create.productId !== productId) continue;
    fields[create.variantId] = readPendingVariantFields(create);
  }
  return fields;
}

function mergeField(current: string, previous: string, next: string): string {
  return current === previous ? next : current;
}

function statusLabel(status: string | undefined): "Active" | "Inactive" {
  return status === "inactive" ? "Inactive" : "Active";
}

export function PartnerProductEditor(props: Readonly<{
  product: StageProduct;
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
  assets: readonly StageAsset[];
  commercialAssetOptions: readonly PartnerCommercialAssetOption[];
  categories: readonly StageCategory[];
  draft: PartnerEditorDraft | null;
  productNames: Readonly<Record<string, string>>;
  variantProductIds: Readonly<Record<string, string>>;
  modelThumbnailUrls?: Readonly<Record<string, string | null>>;
}>) {
  const draftRef = useRef(props.draft);
  const [draft, setDraft] = useState(props.draft);
  const [productFields, setProductFields] = useState<PartnerEditorProductFields>(() => (
    readPartnerProductFields(props.product, props.draft?.document ?? null)
  ));
  const [variantFields, setVariantFields] = useState(() => (
    variantFieldMap(props.product.productId, props.variants, props.draft?.document ?? null)
  ));
  const [saveState, setSaveState] = useState<PartnerSaveStateValue | null>(() => (
    describeSavedPartnerProductChanges({
      product: props.product,
      variants: props.variants,
      collections: props.collections,
      document: props.draft?.document ?? null,
    }).length > 0 ? "saved" : null
  ));
  const [busy, setBusy] = useState<null | "save" | "review" | "publish" | "discard">(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictNote, setConflictNote] = useState(PARTNER_EDITOR_CONFLICT);
  const [review, setReview] = useState<PartnerProductReview | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addFinish, setAddFinish] = useState("");
  const [addShortName, setAddShortName] = useState("");
  const [showShortName, setShowShortName] = useState(false);
  const [addSku, setAddSku] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addModel, setAddModel] = useState<AddModelSelection | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const uploads = usePartnerInlineGlbUploads();
  const [measuredByAsset, setMeasuredByAsset] = useState<Readonly<Record<string, ModelSize>>>({});
  const uploadLocks = useRef(new Set<string>());
  draftRef.current = draft;

  const draftDocument = draft?.document ?? null;

  function nativeFor(assetId: string | null): ModelSize | null {
    if (assetId && measuredByAsset[assetId]) return measuredByAsset[assetId];
    return nativeForAsset(assetId, props.assets, props.commercialAssetOptions);
  }

  function rememberMeasured(assetId: string, size: ModelSize | null) {
    if (!size) return;
    setMeasuredByAsset((current) => (
      current[assetId] ? current : { ...current, [assetId]: size }
    ));
  }
  const productVariants = props.variants.filter((variant) => variant.productId === props.product.productId);
  const pendingVariants = (draftDocument?.variants.create ?? []).filter((create) => create.productId === props.product.productId);
  const manualSignature = partnerVariantManualIds(productVariants).join("\n");
  const [variantSort, setVariantSort] = useState<PartnerVariantSort>("manual");
  const [manualIds, setManualIds] = useState<readonly string[]>(() => partnerVariantManualIds(productVariants));
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const manualRef = useRef<readonly string[]>(partnerVariantManualIds(productVariants));
  const savedOrderRef = useRef<readonly string[]>(partnerVariantManualIds(productVariants));
  const draggingVariantRef = useRef<string | null>(null);
  const droppedVariantRef = useRef(false);
  const orderBusyRef = useRef(false);
  useEffect(() => {
    const ids = manualSignature.length > 0 ? manualSignature.split("\n") : [];
    manualRef.current = ids;
    savedOrderRef.current = ids;
    setManualIds(ids);
  }, [manualSignature]);
  const labels = partnerCategoryLabels(props.categories, props.product.categoryId, props.product.subcategoryId);
  const collections = partnerEditorCollectionChoices({
    productId: props.product.productId,
    collections: props.collections,
    document: draftDocument,
  });
  const modelOptions = useMemo(() => props.commercialAssetOptions.map((option) => ({
    assetId: option.assetId,
    label: partnerEditorAssetOptionLabel(option),
  })), [props.commercialAssetOptions]);
  const savedChanges = describeSavedPartnerProductChanges({
    product: props.product,
    variants: productVariants,
    collections: props.collections,
    document: draftDocument,
    assetLabel: labelForAsset,
  });
  const draftInclusions = describePartnerPublishInclusions({
    document: draftDocument,
    productId: props.product.productId,
    productNames: props.productNames,
    variantProductIds: props.variantProductIds,
  });
  const reviewCurrent = review != null && reviewedRevision === draft?.revision;
  const productChanges = reviewCurrent && review ? review.changes : savedChanges;
  const otherLines = reviewCurrent && review ? review.otherLines : draftInclusions;
  const issues = reviewCurrent && review ? review.issues : [];
  const uploadBusy = uploads.anyBusy();
  const canPublish = Boolean(reviewCurrent && review?.publishable && !conflict && busy == null && !uploadBusy);
  const canReview = draft != null
    && busy == null
    && !conflict
    && !uploadBusy
    && partnerEditorDocumentHasChanges(draftDocument);
  const canDiscard = draft != null && busy == null && !uploadBusy && partnerEditorDocumentHasChanges(draftDocument);
  const disabled = busy != null || conflict || uploadBusy;

  function labelForAsset(assetId: string): string {
    const label = partnerEditorAssetLabel(props.commercialAssetOptions, assetId);
    if (label !== "Ready") return label;
    const fileName = uploads.fileName(assetId);
    return fileName ? `${fileName} · Ready` : label;
  }

  function addModelView(): PartnerVariantModelPresentation {
    if (!addModel) {
      return { stateLabel: "No 3D model", filename: null, detail: null, note: null };
    }
    const thumbnailUrl = partnerVariantAssignedThumbnailUrl(addModel.assetId, props.modelThumbnailUrls);
    return {
      stateLabel: "Ready",
      filename: addModel.fileName,
      detail: null,
      note: null,
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    };
  }

  const imageUrl = safeHttpUrl(productFields.imageUrl);
  const hasReadyModel = props.commercialAssetOptions.length > 0;

  function adoptDraft(next: PartnerEditorDraft, replace = false) {
    const previous = draftRef.current?.document ?? null;
    draftRef.current = next;
    setDraft(next);
    const previousProduct = readPartnerProductFields(props.product, previous);
    const nextProduct = readPartnerProductFields(props.product, next.document);
    setProductFields((current) => replace ? nextProduct : {
      name: mergeField(current.name, previousProduct.name, nextProduct.name),
      imageUrl: mergeField(current.imageUrl, previousProduct.imageUrl, nextProduct.imageUrl),
      productUrl: mergeField(current.productUrl, previousProduct.productUrl, nextProduct.productUrl),
      price: mergeField(current.price, previousProduct.price, nextProduct.price),
    });
    setVariantFields((current) => {
      if (replace) return variantFieldMap(props.product.productId, props.variants, next.document);
      const previousFields = variantFieldMap(props.product.productId, props.variants, previous);
      const nextFields = variantFieldMap(props.product.productId, props.variants, next.document);
      const merged: Record<string, PartnerEditorVariantFields> = {};
      for (const [variantId, saved] of Object.entries(nextFields)) {
        const local = current[variantId];
        const prior = previousFields[variantId];
        if (!local || !prior) {
          merged[variantId] = saved;
          continue;
        }
        merged[variantId] = {
          finish: mergeField(local.finish, prior.finish, saved.finish),
          sku: mergeField(local.sku, prior.sku, saved.sku),
          price: mergeField(local.price, prior.price, saved.price),
          productUrl: mergeField(local.productUrl, prior.productUrl, saved.productUrl),
        };
      }
      return merged;
    });
  }

  async function ensureDraft(): Promise<PartnerEditorDraft | null> {
    if (draftRef.current) return draftRef.current;
    const response = await fetch("/api/vibode/partner/drafts", { method: "POST" });
    const body = await response.json() as { error?: string; draft?: unknown };
    const next = readPartnerEditorDraftResponse(body.draft);
    if (!response.ok || !next) {
      setError(partnerEditorErrorMessage(body.error));
      return null;
    }
    adoptDraft(next);
    return next;
  }

  async function persist(
    mutations: readonly PartnerEditorMutation[],
    options?: { attachingUploadedModel?: boolean },
  ): Promise<{ ok: true } | { ok: false; conflict: boolean }> {
    if (conflict || mutations.length === 0) return { ok: false, conflict };
    setBusy("save");
    setSaveState("saving");
    setError(null);
    try {
      const current = await ensureDraft();
      if (!current) {
        setSaveState("failed");
        return { ok: false, conflict: false };
      }
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision, mutations }),
      });
      const body = await response.json() as { error?: string; draft?: unknown };
      if (response.status === 409) {
        const uploaded = options?.attachingUploadedModel
          ? partnerUploadedModelAssociationFailure({ uploadReady: true, httpStatus: 409 })
          : null;
        setConflict(true);
        setConflictNote(uploaded?.message ?? PARTNER_EDITOR_CONFLICT);
        setSaveState("failed");
        setError(uploaded?.message ?? PARTNER_EDITOR_CONFLICT_ALERT);
        return { ok: false, conflict: true };
      }
      const next = readPartnerEditorDraftResponse(body.draft);
      if (!response.ok || !next) {
        setSaveState("failed");
        setError(partnerEditorErrorMessage(body.error));
        return { ok: false, conflict: false };
      }
      adoptDraft(next);
      setSaveState("saved");
      return { ok: true };
    } catch {
      setSaveState("failed");
      setError(PARTNER_SAVE_FAILED);
      return { ok: false, conflict: false };
    } finally {
      setBusy(null);
    }
  }

  function applyCommit(commit: PartnerEditorCommit) {
    if (commit.state === "unchanged") {
      setSaveState(savedChanges.length > 0 ? "saved" : null);
      return;
    }
    if (commit.state === "invalid") {
      setSaveState("failed");
      setError(commit.message);
      return;
    }
    void persist([commit.mutation]);
  }

  async function uploadNewModel(file: File) {
    if (uploadLocks.current.has("create") || conflict) return;
    uploadLocks.current.add("create");
    try {
      const outcome = await uploads.run("create", file);
      if (outcome.status !== "ready" || !uploads.isCurrent("create", outcome.token)) return;
      uploads.remember(outcome.assetId, outcome.fileName);
      const measured = modelSizeFromMeasured({
        widthM: outcome.measuredWidthM,
        heightM: outcome.measuredHeightM,
        depthM: outcome.measuredDepthM,
      });
      rememberMeasured(outcome.assetId, measured);
      if (measured) {
        setAddModel((current) => addModelSelection(
          outcome.assetId,
          outcome.fileName,
          "upload",
          measured,
          current,
        ));
      }
      uploads.settle("create");
    } finally {
      uploadLocks.current.delete("create");
    }
  }

  async function uploadPendingModel(variantId: string, file: File) {
    if (uploadLocks.current.has(variantId) || conflict) return;
    uploadLocks.current.add(variantId);
    try {
      const outcome = await uploads.run(variantId, file);
      if (outcome.status !== "ready" || !uploads.isCurrent(variantId, outcome.token)) return;
      const pending = draftRef.current?.document.variants.create.find((item) => item.variantId === variantId);
      if (!pending || pending.productId !== props.product.productId) return;
      const commit = commitPendingVariantModel(variantId, outcome.assetId, pending.currentAssetId);
      if (commit.state !== "mutation") {
        uploads.settle(variantId);
        return;
      }
      const saved = await persist([commit.mutation], { attachingUploadedModel: true });
      if (!uploads.isCurrent(variantId, outcome.token)) return;
      if (!saved.ok) {
        const failure = saved.conflict
          ? partnerUploadedModelAssociationFailure({ uploadReady: true, httpStatus: 409 })
          : null;
        uploads.showAttention(variantId, {
          phase: "attention",
          fileName: outcome.fileName,
          message: failure?.message ?? PARTNER_MODEL_UPLOADED_NOT_ATTACHED,
          technical: null,
          reload: Boolean(failure?.reload),
        });
        return;
      }
      uploads.remember(outcome.assetId, outcome.fileName);
      rememberMeasured(outcome.assetId, modelSizeFromMeasured({
        widthM: outcome.measuredWidthM,
        heightM: outcome.measuredHeightM,
        depthM: outcome.measuredDepthM,
      }));
      uploads.settle(variantId);
    } finally {
      uploadLocks.current.delete(variantId);
    }
  }

  function chooseExistingModel(assetId: string) {
    const option = props.commercialAssetOptions.find((item) => item.assetId === assetId);
    if (!option) return;
    const native = nativeModelDimensions(option);
    if (!native) return;
    uploads.settle("create");
    setAddModel((current) => addModelSelection(
      option.assetId,
      option.originalFileName,
      "existing",
      native,
      current,
    ));
  }

  function reviewContext(current: PartnerCatalogSyncDocument | null) {
    const variantLabels: Record<string, string> = {};
    for (const variant of productVariants) {
      const fields = readPartnerVariantFields(variant, current);
      variantLabels[variant.variantId] = partnerVariantHeading(fields.finish || null, fields.sku || null);
    }
    for (const create of current?.variants.create ?? []) {
      variantLabels[create.variantId] = partnerVariantHeading(create.finishLabel, create.sku);
    }
    const collectionNames: Record<string, string> = {};
    for (const collection of props.collections) collectionNames[collection.collectionId] = collection.name;
    for (const create of current?.collections.create ?? []) collectionNames[create.collectionId] = create.name;
    return {
      productId: props.product.productId,
      productNames: props.productNames,
      variantLabels,
      collectionNames,
      variantProductIds: props.variantProductIds,
      assetLabel: (assetId: string) => labelForAsset(assetId),
    };
  }

  async function runReview() {
    const current = draftRef.current;
    if (!current || busy) return;
    setBusy("review");
    setError(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      const body: unknown = await response.json();
      const presented = presentPartnerDraftPreview(body);
      setReview(describePartnerProductReview(presented, reviewContext(current.document)));
      setReviewedRevision(current.revision);
      document.getElementById("product-publishing")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      setReview({
        publishable: false,
        issues: ["Changes could not be reviewed. Try again."],
        changes: [],
        otherLines: [],
      });
      setReviewedRevision(current.revision);
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    const current = draftRef.current;
    if (!current || !canPublish || conflict) return;
    const confirmed = window.confirm(partnerPublishConfirmation(otherLines, productChanges.length));
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
      if (response.status === 409 && (body.code === "STALE_LIVE_FIELD" || body.code === "STALE_CATALOG_BASE")) {
        setReview(null);
        setReviewedRevision(null);
        setError("The live catalog changed. Reload this product and review again before publishing.");
        return;
      }
      if (response.status === 409) {
        setConflict(true);
        setError(PARTNER_PAGE_CHANGED);
        return;
      }
      if (response.status === 400) {
        const presented = presentPartnerDraftPreview(
          body && typeof body === "object" ? { ...body, error: undefined } : { error: "Changes could not be reviewed." },
        );
        setReview(describePartnerProductReview(presented, reviewContext(current.document)));
        setReviewedRevision(current.revision);
        setError("These changes need attention before they can be published.");
        return;
      }
      if (!response.ok || body.ok !== true) {
        setError(partnerEditorErrorMessage(body.error, PARTNER_PUBLISH_FAILED));
        return;
      }
      window.location.assign("/partner/catalog");
    } catch {
      setError(PARTNER_PUBLISH_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    const current = draftRef.current;
    if (!current) return;
    if (!window.confirm(PARTNER_DISCARD_CONFIRMATION)) return;
    setBusy("discard");
    setError(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${current.draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision, status: "abandoned" }),
      });
      const body = await response.json() as { error?: string };
      if (response.status === 409) {
        setConflict(true);
        setError(PARTNER_PAGE_CHANGED);
        return;
      }
      if (!response.ok) {
        setError(partnerEditorErrorMessage(body.error, "Unpublished changes could not be discarded."));
        return;
      }
      window.location.assign("/partner/catalog");
    } catch {
      setError("Unpublished changes could not be discarded.");
    } finally {
      setBusy(null);
    }
  }

  function onCollectionToggle(collectionId: string, checked: boolean) {
    const choice = collections.find((item) => item.collectionId === collectionId);
    if (!choice) return;
    const added = (draftDocument?.collections.membershipAdd ?? [])
      .filter((item) => item.collectionId === collectionId)
      .map((item) => item.productId);
    const removed = (draftDocument?.collections.membershipRemove ?? [])
      .filter((item) => item.collectionId === collectionId)
      .map((item) => item.productId);
    const currentIds = collectionProductIds({
      liveProductIds: choice.liveProductIds,
      addedProductIds: added,
      removedProductIds: removed,
    });
    const nextIds = toggleProductInCollection(currentIds, props.product.productId, checked);
    void persist([collectionMembershipMutation({
      collectionId,
      productIds: nextIds,
      pending: choice.pending,
    })]);
  }

  function previewVariantMove(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const draggingId = draggingVariantRef.current;
    if (!draggingId || draggingId === targetId || orderBusyRef.current) return;
    const current = manualRef.current;
    const from = current.indexOf(draggingId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const afterMidpoint = event.clientY > bounds.top + bounds.height / 2;
    if (to > from && !afterMidpoint) return;
    if (to < from && afterMidpoint) return;
    const next = movePartnerVariant(current, from, to);
    manualRef.current = next;
    setManualIds(next);
  }

  function moveVariantByKey(variantId: string, direction: -1 | 1) {
    if (orderBusyRef.current || disabled) return;
    const current = manualRef.current;
    const from = current.indexOf(variantId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = movePartnerVariant(current, from, to);
    manualRef.current = next;
    setManualIds(next);
    void persistVariantOrder(next);
  }

  async function persistVariantOrder(next: readonly string[]) {
    if (orderBusyRef.current || samePartnerVariantOrder(next, savedOrderRef.current)) return;
    orderBusyRef.current = true;
    setOrderBusy(true);
    setOrderError(null);
    try {
      const response = await fetch("/api/vibode/partner/catalog/variants/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: props.product.productId,
          variantIds: next,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        manualRef.current = savedOrderRef.current;
        setManualIds([...savedOrderRef.current]);
        setOrderError(body?.error ?? "The variant order could not be saved.");
        return;
      }
      const committed = [...next];
      savedOrderRef.current = committed;
      manualRef.current = committed;
      setManualIds(committed);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PARTNER_VARIANT_ORDER_SAVED_EVENT));
      }
    } catch {
      manualRef.current = savedOrderRef.current;
      setManualIds([...savedOrderRef.current]);
      setOrderError("The variant order could not be saved.");
    } finally {
      orderBusyRef.current = false;
      setOrderBusy(false);
    }
  }

  const variantCards = [
    ...productVariants.map((variant) => {
      const fields = variantFields[variant.variantId];
      return {
        id: variant.variantId,
        published: true,
        label: partnerVariantOrderLabel({
          finish: fields?.finish ?? variant.finishLabel,
          sku: fields?.sku ?? variant.sku,
          variantId: variant.variantId,
        }),
      };
    }),
    ...pendingVariants.map((create) => {
      const fields = variantFields[create.variantId];
      return {
        id: create.variantId,
        published: false,
        label: partnerVariantOrderLabel({
          finish: fields?.finish ?? create.finishLabel,
          sku: fields?.sku ?? create.sku,
          variantId: create.variantId,
        }),
      };
    }),
  ];
  const orderedVariantCards = orderPartnerVariantCards(variantCards, variantSort, manualIds);
  const showVariantSort = variantCards.length >= 2;

  const savedProduct = readPartnerProductFields(props.product, draftDocument);
  const pendingProductStatus = partnerEditorPendingProductStatus(draftDocument, props.product.productId);

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <a href="/partner/catalog" className="text-sm text-slate-300 underline-offset-2 hover:underline">
          Back to Catalog
        </a>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-800">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- partner catalog images are durable remote or public URLs
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">No image</div>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold tracking-tight">{productFields.name || props.product.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={props.product.status === "inactive"
                  ? "rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300"
                  : "rounded-full border border-emerald-900 bg-emerald-950/50 px-2 py-0.5 text-xs text-emerald-200"}
                >
                  {statusLabel(props.product.status)}
                </span>
                {pendingProductStatus ? (
                  <span className="text-xs text-amber-200">
                    Pending: {pendingProductStatus === "inactive" ? "Inactive" : "Active"}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-2 py-0.5 text-xs font-medium text-slate-100 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                  onClick={() => {
                    void persist([partnerProductStatusMutation(
                      props.product.productId,
                      props.product.status === "inactive" ? "active" : "inactive",
                    )]);
                  }}
                >
                  {props.product.status === "inactive" ? "Set active" : "Set inactive"}
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <PartnerSaveState state={saveState} />
            {canPublish || busy === "publish" ? (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canPublish}
                onClick={() => void publish()}
              >
                {busy === "publish" ? "Publishing…" : "Publish changes"}
              </button>
            ) : canReview || busy === "review" ? (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy != null}
                onClick={() => void runReview()}
              >
                {busy === "review" ? "Reviewing…" : "Review changes"}
              </button>
            ) : null}
          </div>
        </div>
        {conflict ? (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
            {conflictNote}
            <button
              type="button"
              className="ml-3 rounded-md border border-amber-600 px-2 py-0.5 text-xs"
              onClick={() => window.location.reload()}
            >
              Reload product
            </button>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-rose-200">{error}</p> : null}
      </header>

      <section aria-labelledby="product-details-heading" className="space-y-4 rounded-xl border border-slate-800 p-4">
        <h2 id="product-details-heading" className="text-lg font-medium">Product</h2>
        <PartnerProductFields
          name={productFields.name}
          price={productFields.price}
          currency={props.product.priceCurrency}
          imageUrl={productFields.imageUrl}
          productUrl={productFields.productUrl}
          category={labels.category}
          subcategory={labels.subcategory}
          collections={collections}
          disabled={disabled}
          onNameChange={(value) => {
            setSaveState("unsaved");
            setProductFields((current) => ({ ...current, name: value }));
          }}
          onNameCommit={() => applyCommit(commitPartnerProductName(props.product.productId, productFields.name, savedProduct.name))}
          onPriceChange={(value) => {
            setSaveState("unsaved");
            setProductFields((current) => ({ ...current, price: value }));
          }}
          onPriceCommit={() => applyCommit(commitPartnerProductPrice(props.product.productId, productFields.price, savedProduct.price))}
          onImageChange={(value) => {
            setSaveState("unsaved");
            setProductFields((current) => ({ ...current, imageUrl: value }));
          }}
          onImageCommit={() => applyCommit(commitPartnerProductImage(props.product.productId, productFields.imageUrl, savedProduct.imageUrl))}
          onProductUrlChange={(value) => {
            setSaveState("unsaved");
            setProductFields((current) => ({ ...current, productUrl: value }));
          }}
          onProductUrlCommit={() => applyCommit(commitPartnerProductUrl(props.product.productId, productFields.productUrl, savedProduct.productUrl))}
          onCollectionToggle={onCollectionToggle}
        />
      </section>

      <section
        aria-labelledby="product-variants-heading"
        className="space-y-4"
        {...(showVariantSort ? { "data-variant-sort": variantSort } : {})}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <h2 id="product-variants-heading" className="text-lg font-medium">Variants</h2>
            {showVariantSort ? (
              <label className="block text-xs text-slate-400">
                Sort
                <select
                  aria-label="Sort"
                  value={variantSort}
                  onChange={(event) => setVariantSort(event.target.value as PartnerVariantSort)}
                  className={`mt-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 ${FOCUS}`}
                >
                  <option value="manual">Manual</option>
                  <option value="name_asc">Name A–Z</option>
                  <option value="name_desc">Name Z–A</option>
                </select>
              </label>
            ) : null}
          </div>
          {!adding ? (
            <button
              type="button"
              className={SECONDARY}
              disabled={disabled}
              onClick={() => {
                uploads.invalidate("create");
                setAdding(true);
                setAddError(null);
                setAddFinish("");
                setAddShortName("");
                setShowShortName(false);
                setAddSku("");
                setAddPrice("");
                setAddUrl("");
                setAddModel(null);
              }}
            >
              Add variant
            </button>
          ) : null}
        </div>
        {showVariantSort ? (
          <p className="text-xs text-slate-500">
            {variantSort === "manual"
              ? "Drag to set the manual order shoppers see. Name sorts only change this view."
              : "This name sort only changes this view. Shoppers still follow Manual order."}
            {pendingVariants.length > 0 && variantSort === "manual"
              ? " Unpublished variants stay at the end until you publish."
              : ""}
          </p>
        ) : null}
        {orderError ? <p role="alert" className="text-sm text-rose-300">{orderError}</p> : null}
        {productVariants.length === 0 && pendingVariants.length === 0 ? (
          <p className="text-sm text-slate-400">No variants yet.</p>
        ) : null}
        <div className="space-y-3">
          {orderedVariantCards.map((card) => {
            const showReorderHandle = variantSort === "manual" && card.published && productVariants.length >= 2;
            const variant = card.published
              ? productVariants.find((item) => item.variantId === card.id) ?? null
              : null;
            const create = card.published
              ? null
              : pendingVariants.find((item) => item.variantId === card.id) ?? null;
            if (!variant && !create) return null;
            const publishedFields = variant
              ? variantFields[variant.variantId] ?? readPartnerVariantFields(variant, draftDocument)
              : null;
            const publishedSaved = variant ? readPartnerVariantFields(variant, draftDocument) : null;
            const publishedModel = variant ? presentPartnerVariantModel({
              assetId: variant.assetId,
              assets: props.assets,
              options: props.commercialAssetOptions,
              published: true,
              thumbnailUrls: props.modelThumbnailUrls,
            }) : null;
            const pendingVariantStatus = variant
              ? partnerEditorPendingVariantStatus(draftDocument, variant.variantId)
              : null;
            const pendingFields = create
              ? variantFields[create.variantId] ?? readPendingVariantFields(create)
              : null;
            const pendingSaved = create ? readPendingVariantFields(create) : null;
            const pendingModel = create ? presentPartnerVariantModel({
              assetId: create.currentAssetId,
              assets: props.assets,
              options: props.commercialAssetOptions,
              published: false,
              uploadedFileName: uploads.fileName(create.currentAssetId),
              thumbnailUrls: props.modelThumbnailUrls,
            }) : null;
            const uploadView = create ? uploads.view(create.variantId) : null;
            const pendingKnown = create
              ? props.commercialAssetOptions.some((option) => option.assetId === create.currentAssetId)
                || uploads.fileName(create.currentAssetId) != null
              : false;
            return (
              <div
                key={card.id}
                className={showReorderHandle ? "flex items-start gap-2" : undefined}
                onDragOver={showReorderHandle ? (event) => previewVariantMove(event, card.id) : undefined}
                onDrop={showReorderHandle ? (event) => {
                  event.preventDefault();
                  droppedVariantRef.current = true;
                  void persistVariantOrder(manualRef.current);
                } : undefined}
              >
                {showReorderHandle ? (
                  <button
                    type="button"
                    draggable={!disabled && !orderBusy}
                    aria-label={`Reorder ${card.label}`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    className={`mt-4 cursor-grab rounded-md px-1.5 py-1 text-slate-400 hover:text-slate-100 active:cursor-grabbing ${FOCUS}`}
                    onDragStart={(event) => {
                      draggingVariantRef.current = card.id;
                      droppedVariantRef.current = false;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", card.id);
                    }}
                    onDragEnd={() => {
                      const dropped = droppedVariantRef.current;
                      droppedVariantRef.current = false;
                      draggingVariantRef.current = null;
                      if (!dropped) {
                        manualRef.current = savedOrderRef.current;
                        setManualIds([...savedOrderRef.current]);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      moveVariantByKey(card.id, event.key === "ArrowUp" ? -1 : 1);
                    }}
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                ) : null}
                <div className={showReorderHandle ? "min-w-0 flex-1" : undefined}>
                  {variant && publishedFields && publishedSaved && publishedModel ? (
                    <PartnerVariantFields
                      heading={partnerVariantHeading(publishedFields.finish || null, publishedFields.sku || null)}
                      statusLabel={statusLabel(variant.status)}
                      statusAction={variant.status === "inactive" ? "Set active" : "Set inactive"}
                      pendingStatus={pendingVariantStatus === "inactive"
                        ? "Inactive"
                        : pendingVariantStatus === "active"
                          ? "Active"
                          : null}
                      onStatusAction={() => {
                        void persist([partnerVariantStatusMutation(
                          variant.variantId,
                          variant.status === "inactive" ? "active" : "inactive",
                        )]);
                      }}
                      isDefault={variant.variantId === props.product.defaultVariantId}
                      modelState={publishedModel.stateLabel}
                      finish={publishedFields.finish}
                      sku={publishedFields.sku}
                      price={publishedFields.price}
                      currency={variant.priceCurrency || props.product.priceCurrency}
                      productUrl={publishedFields.productUrl}
                      disabled={disabled}
                      pending={false}
                      onFinishChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [variant.variantId]: { ...publishedFields, finish: value },
                        }));
                      }}
                      onFinishCommit={() => applyCommit(commitPartnerVariantFinish(
                        variant.variantId,
                        publishedFields.finish,
                        publishedSaved.finish,
                      ))}
                      onSkuChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [variant.variantId]: { ...publishedFields, sku: value },
                        }));
                      }}
                      onSkuCommit={() => applyCommit(commitPartnerVariantSku(
                        variant.variantId,
                        publishedFields.sku,
                        publishedSaved.sku,
                      ))}
                      onPriceChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [variant.variantId]: { ...publishedFields, price: value },
                        }));
                      }}
                      onPriceCommit={() => applyCommit(commitPartnerVariantPrice(
                        variant.variantId,
                        publishedFields.price,
                        publishedSaved.price,
                      ))}
                      onProductUrlChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [variant.variantId]: { ...publishedFields, productUrl: value },
                        }));
                      }}
                      onProductUrlCommit={() => applyCommit(commitPartnerVariantUrl(
                        variant.variantId,
                        publishedFields.productUrl,
                        publishedSaved.productUrl,
                      ))}
                      model={(
                        <div className="space-y-4">
                          <PartnerVariantModelSummary
                            presentation={publishedModel}
                            productName={productFields.name || props.product.name}
                            finish={publishedFields.finish}
                          />
                          {nativeFor(variant.assetId) ? (
                            <PartnerModelDimensions
                              key={`${variant.variantId}:${variant.assetId ?? ""}:${canonicalModelDimensions(savedVariantDimensions(variant, draftDocument)) ?? "native"}`}
                              native={nativeFor(variant.assetId)!}
                              dimensions={savedVariantDimensions(variant, draftDocument)}
                              disabled={disabled}
                              onCommit={(next) => applyCommit(commitPartnerVariantModelDimensions(
                                variant.variantId,
                                next,
                                savedVariantDimensions(variant, draftDocument),
                              ))}
                            />
                          ) : null}
                        </div>
                      )}
                    />
                  ) : null}
                  {create && pendingFields && pendingSaved && pendingModel && uploadView ? (
                    <PartnerVariantFields
                      heading={partnerVariantHeading(pendingFields.finish || null, pendingFields.sku || null)}
                      statusLabel="Active"
                      isDefault={false}
                      modelState={partnerInlineGlbModelStatusLabel(pendingModel.stateLabel, uploadView)}
                      finish={pendingFields.finish}
                      sku={pendingFields.sku}
                      price={pendingFields.price}
                      currency={create.priceCurrency || props.product.priceCurrency}
                      productUrl={pendingFields.productUrl}
                      disabled={disabled}
                      pending
                      onFinishChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [create.variantId]: { ...pendingFields, finish: value },
                        }));
                      }}
                      onFinishCommit={() => applyCommit(commitPendingVariantFinish(
                        create.variantId,
                        pendingFields.finish,
                        pendingSaved.finish,
                      ))}
                      onSkuChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [create.variantId]: { ...pendingFields, sku: value },
                        }));
                      }}
                      onSkuCommit={() => applyCommit(commitPendingVariantSku(
                        create.variantId,
                        pendingFields.sku,
                        pendingSaved.sku,
                      ))}
                      onPriceChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [create.variantId]: { ...pendingFields, price: value },
                        }));
                      }}
                      onPriceCommit={() => applyCommit(commitPendingVariantPrice(
                        create.variantId,
                        pendingFields.price,
                        pendingSaved.price,
                      ))}
                      onProductUrlChange={(value) => {
                        setSaveState("unsaved");
                        setVariantFields((current) => ({
                          ...current,
                          [create.variantId]: { ...pendingFields, productUrl: value },
                        }));
                      }}
                      onProductUrlCommit={() => applyCommit(commitPendingVariantUrl(
                        create.variantId,
                        pendingFields.productUrl,
                        pendingSaved.productUrl,
                      ))}
                      onRemove={() => {
                        uploads.invalidate(create.variantId);
                        void persist([removePendingVariantMutation(create.variantId)]);
                      }}
                      model={(
                        <div className="space-y-4">
                          <PartnerInlineModelPanel
                            saved={{
                              ...pendingModel,
                              detail: partnerVariantModelCardDetail(
                                pendingModel.detail,
                                productFields.name || props.product.name,
                                pendingFields.finish,
                              ),
                            }}
                            upload={uploadView}
                            options={modelOptions}
                            selectedAssetId={create.currentAssetId}
                            disabled={disabled || uploads.busy(create.variantId)}
                            invalid={!pendingKnown}
                            onFile={(file) => void uploadPendingModel(create.variantId, file)}
                            onChoose={(next) => {
                              uploads.settle(create.variantId);
                              applyCommit(commitPendingVariantModel(create.variantId, next, create.currentAssetId));
                            }}
                          />
                          {nativeFor(create.currentAssetId) ? (
                            <PartnerModelDimensions
                              key={`${create.variantId}:${create.currentAssetId}:${canonicalModelDimensions(explicitModelDimensions(create)) ?? "native"}`}
                              native={nativeFor(create.currentAssetId)!}
                              dimensions={explicitModelDimensions(create)}
                              disabled={disabled || uploads.busy(create.variantId)}
                              onCommit={(next) => applyCommit(commitPendingVariantModelDimensions(
                                create.variantId,
                                next,
                                explicitModelDimensions(create),
                              ))}
                            />
                          ) : null}
                        </div>
                      )}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!hasReadyModel && !adding ? (
          <p className="text-sm text-slate-300">{PARTNER_VARIANT_MODEL_REQUIRED}</p>
        ) : null}
        {adding ? (
          <form
            className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (uploads.busy("create") || uploadLocks.current.has("create")) return;
              const commit = buildPartnerVariantCreate({
                productId: props.product.productId,
                currency: props.product.priceCurrency,
                finish: addFinish,
                shortName: addShortName,
                sku: addSku,
                price: addPrice,
                productUrl: addUrl,
                assetId: addModel?.assetId ?? "",
                hasReadyModel: Boolean(addModel?.assetId),
                modelDimensions: addModel?.dimensions ?? null,
              });
              if (commit.state === "invalid") {
                if (variantNeedsShortName(addFinish)) setShowShortName(true);
                setAddError(commit.message);
                setSaveState("failed");
                return;
              }
              if (commit.state !== "mutation") return;
              void (async () => {
                const saved = await persist([commit.mutation], {
                  attachingUploadedModel: addModel?.source === "upload",
                });
                if (!saved.ok) {
                  if (saved.conflict && addModel?.source === "upload") {
                    uploads.showAttention("create", {
                      phase: "attention",
                      fileName: addModel.fileName,
                      message: PARTNER_MODEL_UPLOADED_RELOAD,
                      technical: null,
                      reload: true,
                    });
                  }
                  return;
                }
                if (addModel?.fileName) uploads.remember(addModel.assetId, addModel.fileName);
                uploads.settle("create");
                setAdding(false);
                setAddError(null);
                setAddModel(null);
                setAddFinish("");
                setAddShortName("");
                setShowShortName(false);
                setAddSku("");
                setAddPrice("");
                setAddUrl("");
              })();
            }}
          >
            <h3 className="text-sm font-medium">Add variant</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs text-slate-400">
                Finish
                <input
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={addFinish}
                  disabled={disabled}
                  onChange={(event) => setAddFinish(event.target.value)}
                />
              </label>
              {showShortName || (addFinish.trim().length > 0 && variantNeedsShortName(addFinish)) ? (
                <label className="block text-xs text-slate-400">
                  Short name
                  <input
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={addShortName}
                    disabled={disabled}
                    onChange={(event) => setAddShortName(event.target.value)}
                  />
                  <span className="mt-1 block text-slate-500">Needed when the finish cannot identify this variant.</span>
                </label>
              ) : null}
              <label className="block text-xs text-slate-400">
                SKU
                <input
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={addSku}
                  disabled={disabled}
                  onChange={(event) => setAddSku(event.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                {props.product.priceCurrency ? `Price (${props.product.priceCurrency})` : "Price"}
                <input
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  inputMode="decimal"
                  value={addPrice}
                  disabled={disabled}
                  onChange={(event) => setAddPrice(event.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400 sm:col-span-2">
                Product page URL
                <input
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={addUrl}
                  disabled={disabled}
                  onChange={(event) => setAddUrl(event.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <PartnerInlineModelPanel
                  saved={addModelView()}
                  upload={uploads.view("create")}
                  options={modelOptions}
                  selectedAssetId={addModel?.assetId ?? ""}
                  disabled={disabled || uploads.busy("create")}
                  invalid={false}
                  onFile={(file) => void uploadNewModel(file)}
                  onChoose={chooseExistingModel}
                />
                {addModel ? (
                  <PartnerModelDimensions
                    key={`${addModel.assetId}:${canonicalModelDimensions(addModel.dimensions)}`}
                    native={addModel.native}
                    dimensions={addModel.dimensions}
                    disabled={disabled || uploads.busy("create")}
                    onCommit={(next) => setAddModel((current) => (
                      current ? { ...current, dimensions: next } : current
                    ))}
                  />
                ) : null}
              </div>
            </div>
            {addError ? <p role="alert" className="text-sm text-rose-200">{addError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={SECONDARY} disabled={disabled || !addModel || uploads.busy("create")}>
                Add variant
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy != null}
                onClick={() => {
                  uploads.invalidate("create");
                  setAdding(false);
                  setAddError(null);
                  setAddModel(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <PartnerPublishSection
        productChanges={productChanges}
        otherLines={otherLines}
        issues={issues}
        reviewed={reviewCurrent}
        canPublish={canPublish}
        canReview={canReview}
        reviewing={busy === "review"}
        publishing={busy === "publish"}
        onReview={() => void runReview()}
        onPublish={() => void publish()}
      />

      {canDiscard ? (
        <section aria-labelledby="discard-unpublished-heading" className="rounded-xl border border-slate-800 p-4">
          <h2 id="discard-unpublished-heading" className="text-sm font-medium text-slate-200">
            Discard unpublished changes
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            This discards all unpublished Partner catalog changes, not only this product.
          </p>
          <button
            type="button"
            className={`mt-3 ${SECONDARY}`}
            disabled={busy != null}
            onClick={() => void discard()}
          >
            Discard unpublished changes
          </button>
        </section>
      ) : null}
    </div>
  );
}
