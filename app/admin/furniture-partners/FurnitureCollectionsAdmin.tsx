"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type AdminErrorResponse = {
  error?: unknown;
};

type FurniturePartner = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  description: string | null;
  status: "active" | "inactive";
  internal_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type FurnitureCollection = {
  id: string;
  partner_id: string;
  name: string;
  slug: string;
  description: string | null;
  hero_image_url: string | null;
  visibility: "public" | "private" | "unlisted";
  status: "active" | "inactive" | "archived";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type FurnitureCollectionItem = {
  id: string;
  collection_id: string;
  product_name: string;
  product_url: string | null;
  image_url: string | null;
  stored_asset_id: string | null;
  brand: string | null;
  category: string | null;
  price_amount: number | null;
  price_currency: string | null;
  sort_order: number;
  status: "active" | "inactive";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function normalizeText(value: string): string {
  return value.trim();
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  const code = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "CAD";
  return `${code} ${amount.toFixed(2)}`;
}

function statusClasses(status: string): string {
  if (status === "active" || status === "public") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
  }
  if (status === "archived" || status === "inactive" || status === "private") {
    return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  }
  return "border-slate-600 bg-slate-800 text-slate-200";
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as AdminErrorResponse;
  return typeof payload.error === "string" ? payload.error : fallback;
}

export default function FurnitureCollectionsAdmin() {
  const [partners, setPartners] = useState<FurniturePartner[]>([]);
  const [collections, setCollections] = useState<FurnitureCollection[]>([]);
  const [items, setItems] = useState<FurnitureCollectionItem[]>([]);

  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  const [partnersLoading, setPartnersLoading] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [creatingPartner, setCreatingPartner] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);

  const [savingPartner, setSavingPartner] = useState(false);
  const [savingCollection, setSavingCollection] = useState(false);
  const [savingItem, setSavingItem] = useState(false);

  const [deletingPartnerId, setDeletingPartnerId] = useState<string | null>(null);
  const [deletingCollectionId, setDeletingCollectionId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const [partnerForm, setPartnerForm] = useState({
    name: "",
    slug: "",
    website_url: "",
    logo_url: "",
    description: "",
    status: "active" as "active" | "inactive",
    internal_notes: "",
  });

  const [collectionForm, setCollectionForm] = useState({
    name: "",
    slug: "",
    description: "",
    hero_image_url: "",
    visibility: "public" as "public" | "private" | "unlisted",
    status: "active" as "active" | "inactive" | "archived",
  });

  const [itemForm, setItemForm] = useState({
    product_name: "",
    product_url: "",
    image_url: "",
    brand: "",
    category: "",
    price_amount: "",
    price_currency: "CAD",
    sort_order: "",
    status: "active" as "active" | "inactive",
  });

  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.id === selectedPartnerId) ?? null,
    [partners, selectedPartnerId]
  );
  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId]
  );

  const nextDefaultSortOrder = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.max(...items.map((item) => item.sort_order)) + 1;
  }, [items]);

  const clearMessages = () => {
    setPageError(null);
    setPageSuccess(null);
  };

  const loadPartners = useCallback(async () => {
    setPartnersLoading(true);
    try {
      const response = await fetch("/api/vibode/admin/furniture-partners", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed loading Furniture Partners."));
      }
      const payload = (await response.json()) as { partners?: FurniturePartner[] };
      const nextPartners = Array.isArray(payload.partners) ? payload.partners : [];
      setPartners(nextPartners);
      setSelectedPartnerId((currentPartnerId) =>
        currentPartnerId && !nextPartners.some((partner) => partner.id === currentPartnerId)
          ? null
          : currentPartnerId
      );
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed loading Furniture Partners.");
    } finally {
      setPartnersLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async (partnerId: string) => {
    setCollectionsLoading(true);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collections?partnerId=${encodeURIComponent(partnerId)}`,
        { method: "GET", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed loading Furniture Collections."));
      }
      const payload = (await response.json()) as { collections?: FurnitureCollection[] };
      const nextCollections = Array.isArray(payload.collections) ? payload.collections : [];
      setCollections(nextCollections);
      setSelectedCollectionId((currentCollectionId) =>
        currentCollectionId && !nextCollections.some((collection) => collection.id === currentCollectionId)
          ? null
          : currentCollectionId
      );
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed loading Furniture Collections.");
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  const loadItems = useCallback(async (collectionId: string) => {
    setItemsLoading(true);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collection-items?collectionId=${encodeURIComponent(collectionId)}`,
        { method: "GET", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed loading Furniture Collection items."));
      }
      const payload = (await response.json()) as { items?: FurnitureCollectionItem[] };
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(
        [...nextItems].sort((a, b) =>
          a.sort_order === b.sort_order
            ? Date.parse(a.created_at) - Date.parse(b.created_at)
            : a.sort_order - b.sort_order
        )
      );
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed loading Furniture Collection items.");
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    if (!selectedPartnerId) {
      setCollections([]);
      setSelectedCollectionId(null);
      setItems([]);
      return;
    }
    setSelectedCollectionId(null);
    setItems([]);
    void loadCollections(selectedPartnerId);
  }, [selectedPartnerId, loadCollections]);

  useEffect(() => {
    if (!selectedCollectionId) {
      setItems([]);
      return;
    }
    void loadItems(selectedCollectionId);
  }, [selectedCollectionId, loadItems]);

  useEffect(() => {
    if (!selectedPartner) return;
    setPartnerForm({
      name: selectedPartner.name,
      slug: selectedPartner.slug,
      website_url: selectedPartner.website_url ?? "",
      logo_url: selectedPartner.logo_url ?? "",
      description: selectedPartner.description ?? "",
      status: selectedPartner.status,
      internal_notes: selectedPartner.internal_notes ?? "",
    });
  }, [selectedPartner]);

  useEffect(() => {
    if (!selectedCollection) return;
    setCollectionForm({
      name: selectedCollection.name,
      slug: selectedCollection.slug,
      description: selectedCollection.description ?? "",
      hero_image_url: selectedCollection.hero_image_url ?? "",
      visibility: selectedCollection.visibility,
      status: selectedCollection.status,
    });
  }, [selectedCollection]);

  const copyToClipboard = async (value: string, label: string) => {
    clearMessages();
    try {
      await navigator.clipboard.writeText(value);
      setPageSuccess(`${label} copied.`);
    } catch {
      setPageError(`Unable to copy ${label.toLowerCase()}.`);
    }
  };

  const handleCreatePartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearMessages();
    const name = normalizeText(partnerForm.name);
    if (!name) {
      setPageError("Partner name is required.");
      return;
    }

    setCreatingPartner(true);
    try {
      const response = await fetch("/api/vibode/admin/furniture-partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name,
          slug: normalizeText(partnerForm.slug) || undefined,
          website_url: normalizeText(partnerForm.website_url) || null,
          logo_url: normalizeText(partnerForm.logo_url) || null,
          description: normalizeText(partnerForm.description) || null,
          status: partnerForm.status,
          internal_notes: normalizeText(partnerForm.internal_notes) || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed creating Furniture Partner."));
      }
      const payload = (await response.json()) as { partner?: FurniturePartner };
      setPartnerForm({
        name: "",
        slug: "",
        website_url: "",
        logo_url: "",
        description: "",
        status: "active",
        internal_notes: "",
      });
      setPageSuccess("Furniture Partner created.");
      await loadPartners();
      if (payload.partner?.id) setSelectedPartnerId(payload.partner.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed creating Furniture Partner.");
    } finally {
      setCreatingPartner(false);
    }
  };

  const handleUpdatePartner = async () => {
    if (!selectedPartner) return;
    clearMessages();
    const name = normalizeText(partnerForm.name);
    if (!name) {
      setPageError("Partner name is required.");
      return;
    }

    setSavingPartner(true);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-partners/${encodeURIComponent(selectedPartner.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name,
            slug: normalizeText(partnerForm.slug) || undefined,
            website_url: normalizeText(partnerForm.website_url) || null,
            logo_url: normalizeText(partnerForm.logo_url) || null,
            description: normalizeText(partnerForm.description) || null,
            status: partnerForm.status,
            internal_notes: normalizeText(partnerForm.internal_notes) || null,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed updating Furniture Partner."));
      }
      setPageSuccess("Furniture Partner updated.");
      await loadPartners();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed updating Furniture Partner.");
    } finally {
      setSavingPartner(false);
    }
  };

  const handleDisablePartner = async (partnerId: string) => {
    clearMessages();
    setDeletingPartnerId(partnerId);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-partners/${encodeURIComponent(partnerId)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed disabling Furniture Partner."));
      }
      setPageSuccess("Furniture Partner set to inactive.");
      await loadPartners();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed disabling Furniture Partner.");
    } finally {
      setDeletingPartnerId(null);
    }
  };

  const handleCreateCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPartner) return;
    clearMessages();
    const name = normalizeText(collectionForm.name);
    if (!name) {
      setPageError("Collection name is required.");
      return;
    }

    setCreatingCollection(true);
    try {
      const response = await fetch("/api/vibode/admin/furniture-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          partner_id: selectedPartner.id,
          name,
          slug: normalizeText(collectionForm.slug) || undefined,
          description: normalizeText(collectionForm.description) || null,
          hero_image_url: normalizeText(collectionForm.hero_image_url) || null,
          visibility: collectionForm.visibility,
          status: collectionForm.status,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed creating Furniture Collection."));
      }
      const payload = (await response.json()) as { collection?: FurnitureCollection };
      setCollectionForm({
        name: "",
        slug: "",
        description: "",
        hero_image_url: "",
        visibility: "public",
        status: "active",
      });
      setPageSuccess("Furniture Collection created.");
      await loadCollections(selectedPartner.id);
      if (payload.collection?.id) setSelectedCollectionId(payload.collection.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed creating Furniture Collection.");
    } finally {
      setCreatingCollection(false);
    }
  };

  const handleUpdateCollection = async () => {
    if (!selectedCollection || !selectedPartner) return;
    clearMessages();
    const name = normalizeText(collectionForm.name);
    if (!name) {
      setPageError("Collection name is required.");
      return;
    }
    setSavingCollection(true);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collections/${encodeURIComponent(selectedCollection.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            partner_id: selectedPartner.id,
            name,
            slug: normalizeText(collectionForm.slug) || undefined,
            description: normalizeText(collectionForm.description) || null,
            hero_image_url: normalizeText(collectionForm.hero_image_url) || null,
            visibility: collectionForm.visibility,
            status: collectionForm.status,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed updating Furniture Collection."));
      }
      setPageSuccess("Furniture Collection updated.");
      await loadCollections(selectedPartner.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed updating Furniture Collection.");
    } finally {
      setSavingCollection(false);
    }
  };

  const handleArchiveCollection = async (collectionId: string) => {
    if (!selectedPartner) return;
    clearMessages();
    setDeletingCollectionId(collectionId);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collections/${encodeURIComponent(collectionId)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed archiving Furniture Collection."));
      }
      setPageSuccess("Furniture Collection archived.");
      await loadCollections(selectedPartner.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed archiving Furniture Collection.");
    } finally {
      setDeletingCollectionId(null);
    }
  };

  const handleCreateItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCollection) return;
    clearMessages();
    const productName = normalizeText(itemForm.product_name);
    if (!productName) {
      setPageError("Item product_name is required.");
      return;
    }
    const parsedPriceAmount =
      normalizeText(itemForm.price_amount) === "" ? undefined : Number(normalizeText(itemForm.price_amount));
    if (parsedPriceAmount !== undefined && !Number.isFinite(parsedPriceAmount)) {
      setPageError("price_amount must be numeric.");
      return;
    }
    const parsedSortOrder =
      normalizeText(itemForm.sort_order) === ""
        ? nextDefaultSortOrder
        : Number.parseInt(normalizeText(itemForm.sort_order), 10);
    if (!Number.isFinite(parsedSortOrder)) {
      setPageError("sort_order must be an integer.");
      return;
    }

    setCreatingItem(true);
    try {
      const response = await fetch("/api/vibode/admin/furniture-collection-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          collection_id: selectedCollection.id,
          product_name: productName,
          product_url: normalizeText(itemForm.product_url) || null,
          image_url: normalizeText(itemForm.image_url) || null,
          brand: normalizeText(itemForm.brand) || null,
          category: normalizeText(itemForm.category) || null,
          price_amount: parsedPriceAmount,
          price_currency: normalizeText(itemForm.price_currency) || "CAD",
          sort_order: parsedSortOrder,
          status: itemForm.status,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed creating Furniture Collection item."));
      }
      setItemForm({
        product_name: "",
        product_url: "",
        image_url: "",
        brand: "",
        category: "",
        price_amount: "",
        price_currency: "CAD",
        sort_order: "",
        status: "active",
      });
      setPageSuccess("Furniture Collection item created.");
      await loadItems(selectedCollection.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed creating Furniture Collection item.");
    } finally {
      setCreatingItem(false);
    }
  };

  const handleUpdateItem = async (item: FurnitureCollectionItem) => {
    clearMessages();
    const parsedPriceAmount =
      item.price_amount === null || item.price_amount === undefined
        ? null
        : Number(item.price_amount);
    if (parsedPriceAmount !== null && !Number.isFinite(parsedPriceAmount)) {
      setPageError("price_amount must be numeric before saving.");
      return;
    }
    if (!Number.isFinite(item.sort_order)) {
      setPageError("sort_order must be an integer before saving.");
      return;
    }

    setSavingItem(true);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collection-items/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            product_name: item.product_name,
            product_url: item.product_url,
            image_url: item.image_url,
            brand: item.brand,
            category: item.category,
            price_amount: parsedPriceAmount,
            price_currency: item.price_currency,
            sort_order: Math.trunc(item.sort_order),
            status: item.status,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed updating Furniture Collection item."));
      }
      if (selectedCollection) await loadItems(selectedCollection.id);
      setPageSuccess("Furniture Collection item updated.");
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed updating Furniture Collection item.");
    } finally {
      setSavingItem(false);
    }
  };

  const handleDisableItem = async (itemId: string) => {
    if (!selectedCollection) return;
    clearMessages();
    setDeletingItemId(itemId);
    try {
      const response = await fetch(
        `/api/vibode/admin/furniture-collection-items/${encodeURIComponent(itemId)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed disabling Furniture Collection item."));
      }
      setPageSuccess("Furniture Collection item set to inactive.");
      await loadItems(selectedCollection.id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed disabling Furniture Collection item.");
    } finally {
      setDeletingItemId(null);
    }
  };

  const updateItemDraft = (itemId: string, patch: Partial<FurnitureCollectionItem>) => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-50">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Furniture Collections Admin</h1>
          <p className="mt-1 text-sm text-slate-400">
            Internal tools for managing Furniture Partners, Furniture Collections, and collection items.
          </p>
        </header>

        {pageError && <p className="rounded-lg border border-rose-700 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">{pageError}</p>}
        {pageSuccess && <p className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{pageSuccess}</p>}

        <div className="grid gap-4 xl:grid-cols-3">
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Furniture Partners</h2>
              <button
                type="button"
                onClick={() => void loadPartners()}
                disabled={partnersLoading}
                className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-emerald-400 disabled:opacity-60"
              >
                {partnersLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <form className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3" onSubmit={handleCreatePartner}>
              <p className="text-xs uppercase tracking-wide text-slate-400">Create partner</p>
              <input
                value={partnerForm.name}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                placeholder="Name *"
              />
              <input
                value={partnerForm.slug}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, slug: event.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                placeholder="Slug (optional)"
              />
              <input
                value={partnerForm.website_url}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, website_url: event.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                placeholder="Website URL"
              />
              <button
                type="submit"
                disabled={creatingPartner}
                className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {creatingPartner ? "Creating..." : "Create Partner"}
              </button>
            </form>

            <div className="space-y-2">
              {partners.map((partner) => (
                <div
                  key={partner.id}
                  className={`rounded-xl border p-3 ${
                    partner.id === selectedPartnerId ? "border-emerald-500 bg-slate-800/70" : "border-slate-800 bg-slate-950/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{partner.name}</p>
                      <p className="text-xs text-slate-400">{partner.slug}</p>
                    </div>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${statusClasses(partner.status)}`}>
                      {partner.status}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPartnerId(partner.id)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-emerald-400"
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDisablePartner(partner.id)}
                      disabled={deletingPartnerId === partner.id}
                      className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:border-amber-500 disabled:opacity-60"
                    >
                      {deletingPartnerId === partner.id ? "Disabling..." : "Set Inactive"}
                    </button>
                  </div>
                </div>
              ))}
              {partners.length === 0 && <p className="text-sm text-slate-500">No partners yet.</p>}
            </div>

            {selectedPartner && (
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Edit selected partner</p>
                <input
                  value={partnerForm.name}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Name *"
                />
                <input
                  value={partnerForm.slug}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, slug: event.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Slug"
                />
                <input
                  value={partnerForm.logo_url}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, logo_url: event.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Logo URL"
                />
                <input
                  value={partnerForm.website_url}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, website_url: event.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Website URL"
                />
                <textarea
                  value={partnerForm.description}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, description: event.target.value }))}
                  className="h-16 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Description"
                />
                <textarea
                  value={partnerForm.internal_notes}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, internal_notes: event.target.value }))}
                  className="h-16 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  placeholder="Internal notes"
                />
                <select
                  value={partnerForm.status}
                  onChange={(event) =>
                    setPartnerForm((prev) => ({ ...prev, status: event.target.value as "active" | "inactive" }))
                  }
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleUpdatePartner()}
                  disabled={savingPartner}
                  className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:border-emerald-400 disabled:opacity-60"
                >
                  {savingPartner ? "Saving..." : "Save Partner"}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Collections</h2>
              <span className="text-xs text-slate-400">
                {selectedPartner ? `Partner: ${selectedPartner.name}` : "Select a partner"}
              </span>
            </div>

            {selectedPartner ? (
              <>
                <form className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3" onSubmit={handleCreateCollection}>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Create collection</p>
                  <input
                    value={collectionForm.name}
                    onChange={(event) => setCollectionForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                    placeholder="Collection name *"
                  />
                  <input
                    value={collectionForm.slug}
                    onChange={(event) => setCollectionForm((prev) => ({ ...prev, slug: event.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                    placeholder="Slug (optional)"
                  />
                  <select
                    value={collectionForm.visibility}
                    onChange={(event) =>
                      setCollectionForm((prev) => ({
                        ...prev,
                        visibility: event.target.value as "public" | "private" | "unlisted",
                      }))
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  >
                    <option value="public">public</option>
                    <option value="private">private</option>
                    <option value="unlisted">unlisted</option>
                  </select>
                  <button
                    type="submit"
                    disabled={creatingCollection}
                    className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {creatingCollection ? "Creating..." : "Create Collection"}
                  </button>
                </form>

                <div className="space-y-2">
                  {collectionsLoading && <p className="text-sm text-slate-400">Loading collections...</p>}
                  {collections.map((collection) => (
                    <div
                      key={collection.id}
                      className={`rounded-xl border p-3 ${
                        collection.id === selectedCollectionId
                          ? "border-emerald-500 bg-slate-800/70"
                          : "border-slate-800 bg-slate-950/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{collection.name}</p>
                          <p className="text-xs text-slate-400">{collection.slug}</p>
                        </div>
                        <div className="flex gap-1">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${statusClasses(collection.visibility)}`}>
                            {collection.visibility}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${statusClasses(collection.status)}`}>
                            {collection.status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionId(collection.id)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-emerald-400"
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleArchiveCollection(collection.id)}
                          disabled={deletingCollectionId === collection.id}
                          className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:border-amber-500 disabled:opacity-60"
                        >
                          {deletingCollectionId === collection.id ? "Archiving..." : "Archive"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!collectionsLoading && collections.length === 0 && (
                    <p className="text-sm text-slate-500">No collections for this partner yet.</p>
                  )}
                </div>

                {selectedCollection && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Edit selected collection</p>
                    <input
                      value={collectionForm.name}
                      onChange={(event) => setCollectionForm((prev) => ({ ...prev, name: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Name *"
                    />
                    <input
                      value={collectionForm.slug}
                      onChange={(event) => setCollectionForm((prev) => ({ ...prev, slug: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Slug"
                    />
                    <textarea
                      value={collectionForm.description}
                      onChange={(event) =>
                        setCollectionForm((prev) => ({ ...prev, description: event.target.value }))
                      }
                      className="h-16 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Description"
                    />
                    <input
                      value={collectionForm.hero_image_url}
                      onChange={(event) =>
                        setCollectionForm((prev) => ({ ...prev, hero_image_url: event.target.value }))
                      }
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Hero image URL"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={collectionForm.visibility}
                        onChange={(event) =>
                          setCollectionForm((prev) => ({
                            ...prev,
                            visibility: event.target.value as "public" | "private" | "unlisted",
                          }))
                        }
                        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      >
                        <option value="public">public</option>
                        <option value="private">private</option>
                        <option value="unlisted">unlisted</option>
                      </select>
                      <select
                        value={collectionForm.status}
                        onChange={(event) =>
                          setCollectionForm((prev) => ({
                            ...prev,
                            status: event.target.value as "active" | "inactive" | "archived",
                          }))
                        }
                        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="archived">archived</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUpdateCollection()}
                      disabled={savingCollection}
                      className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:border-emerald-400 disabled:opacity-60"
                    >
                      {savingCollection ? "Saving..." : "Save Collection"}
                    </button>

                    {selectedPartner.slug && selectedCollection.slug && (
                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-xs text-slate-300">
                        <p className="font-medium text-slate-100">Collection test URLs</p>
                        <p className="mt-1 break-all font-mono text-[11px]">
                          {`${origin}/api/vibode/furniture-collections/${selectedPartner.slug}/${selectedCollection.slug}`}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void copyToClipboard(
                              `${origin}/api/vibode/furniture-collections/${selectedPartner.slug}/${selectedCollection.slug}`,
                              "Public API URL"
                            )
                          }
                          className="mt-1 rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-emerald-400"
                        >
                          Copy public API URL
                        </button>
                        <p className="mt-2 text-[11px] text-slate-400">Future public page URL (not implemented yet)</p>
                        <p className="break-all font-mono text-[11px]">
                          {`${origin}/furniture-collections/${selectedPartner.slug}/${selectedCollection.slug}`}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void copyToClipboard(
                              `${origin}/furniture-collections/${selectedPartner.slug}/${selectedCollection.slug}`,
                              "Future public page URL"
                            )
                          }
                          className="mt-1 rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-emerald-400"
                        >
                          Copy future page URL
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                Select a Furniture Partner to manage collections.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Collection Items</h2>
              <span className="text-xs text-slate-400">
                {selectedCollection ? `Collection: ${selectedCollection.name}` : "Select a collection"}
              </span>
            </div>

            {selectedCollection ? (
              <>
                <form className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3" onSubmit={handleCreateItem}>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Add item</p>
                  <input
                    value={itemForm.product_name}
                    onChange={(event) => setItemForm((prev) => ({ ...prev, product_name: event.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                    placeholder="Product name *"
                  />
                  <input
                    value={itemForm.image_url}
                    onChange={(event) => setItemForm((prev) => ({ ...prev, image_url: event.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                    placeholder="Image URL"
                  />
                  <input
                    value={itemForm.product_url}
                    onChange={(event) => setItemForm((prev) => ({ ...prev, product_url: event.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                    placeholder="Product URL"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={itemForm.brand}
                      onChange={(event) => setItemForm((prev) => ({ ...prev, brand: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Brand"
                    />
                    <input
                      value={itemForm.category}
                      onChange={(event) => setItemForm((prev) => ({ ...prev, category: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Category"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      value={itemForm.price_amount}
                      onChange={(event) => setItemForm((prev) => ({ ...prev, price_amount: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Price amount"
                    />
                    <input
                      value={itemForm.price_currency}
                      onChange={(event) => setItemForm((prev) => ({ ...prev, price_currency: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder="Currency"
                    />
                    <input
                      value={itemForm.sort_order}
                      onChange={(event) => setItemForm((prev) => ({ ...prev, sort_order: event.target.value }))}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                      placeholder={`Sort order (${nextDefaultSortOrder})`}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creatingItem}
                    className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {creatingItem ? "Adding..." : "Add Item"}
                  </button>
                </form>

                {itemsLoading ? (
                  <p className="text-sm text-slate-400">Loading items...</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <input
                              value={item.product_name}
                              onChange={(event) =>
                                updateItemDraft(item.id, { product_name: event.target.value })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-medium"
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span>{item.brand || "—"}</span>
                              <span>·</span>
                              <span>{item.category || "—"}</span>
                              <span>·</span>
                              <span>{formatPrice(item.price_amount, item.price_currency)}</span>
                              <span>·</span>
                              <span>sort {item.sort_order}</span>
                            </div>
                          </div>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${statusClasses(item.status)}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <input
                            value={item.image_url ?? ""}
                            onChange={(event) => updateItemDraft(item.id, { image_url: event.target.value })}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Image URL"
                          />
                          <input
                            value={item.product_url ?? ""}
                            onChange={(event) => updateItemDraft(item.id, { product_url: event.target.value })}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Product URL"
                          />
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          <input
                            value={item.brand ?? ""}
                            onChange={(event) => updateItemDraft(item.id, { brand: event.target.value })}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Brand"
                          />
                          <input
                            value={item.category ?? ""}
                            onChange={(event) => updateItemDraft(item.id, { category: event.target.value })}
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Category"
                          />
                          <input
                            value={item.price_amount ?? ""}
                            onChange={(event) =>
                              updateItemDraft(item.id, {
                                price_amount:
                                  event.target.value.trim() === ""
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Price"
                          />
                          <input
                            value={item.price_currency ?? ""}
                            onChange={(event) =>
                              updateItemDraft(item.id, { price_currency: event.target.value })
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Currency"
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            value={item.sort_order}
                            onChange={(event) =>
                              updateItemDraft(item.id, {
                                sort_order: Number.parseInt(event.target.value || "0", 10),
                              })
                            }
                            className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            placeholder="Sort"
                          />
                          <select
                            value={item.status}
                            onChange={(event) =>
                              updateItemDraft(item.id, {
                                status: event.target.value as "active" | "inactive",
                              })
                            }
                            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleUpdateItem(item)}
                            disabled={savingItem}
                            className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-emerald-400 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDisableItem(item.id)}
                            disabled={deletingItemId === item.id}
                            className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:border-amber-500 disabled:opacity-60"
                          >
                            {deletingItemId === item.id ? "Disabling..." : "Set Inactive"}
                          </button>
                        </div>
                        {item.image_url && (
                          <div
                            className="mt-2 h-16 w-16 rounded border border-slate-700 bg-cover bg-center"
                            style={{ backgroundImage: `url("${item.image_url}")` }}
                            title={item.product_name}
                          />
                        )}
                      </div>
                    ))}
                    {items.length === 0 && <p className="text-sm text-slate-500">No items for this collection yet.</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
                Select a Furniture Collection to manage items.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
