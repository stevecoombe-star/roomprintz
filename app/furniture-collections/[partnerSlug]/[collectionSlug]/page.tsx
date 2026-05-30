import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import RemoteImage from "./RemoteImage";
import CollectionImportCta from "./CollectionImportCta";

type PublicPartner = {
  name?: string | null;
  slug?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  description?: string | null;
};

type PublicCollection = {
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  hero_image_url?: string | null;
};

type PublicCollectionItem = {
  id?: string;
  product_name?: string | null;
  product_url?: string | null;
  image_url?: string | null;
  brand?: string | null;
  category?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  sort_order?: number | null;
};

type PublicCollectionPayload = {
  partner?: PublicPartner;
  collection?: PublicCollection;
  items?: PublicCollectionItem[];
  error?: string;
};

async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";

  if (host) return `${proto}://${host}`;

  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function fetchPublicCollection(args: {
  partnerSlug: string;
  collectionSlug: string;
}): Promise<{ status: number; payload: PublicCollectionPayload | null }> {
  const baseUrl = await buildBaseUrl();
  const endpoint = `${baseUrl}/api/vibode/furniture-collections/${encodeURIComponent(
    args.partnerSlug
  )}/${encodeURIComponent(args.collectionSlug)}`;

  const response = await fetch(endpoint, { next: { revalidate: 60 } });
  if (!response.ok) return { status: response.status, payload: null };

  const payload = (await response.json().catch(() => null)) as PublicCollectionPayload | null;
  if (!payload) return { status: 500, payload: null };
  return { status: 200, payload };
}

function formatPrice(item: PublicCollectionItem): string | null {
  if (typeof item.price_amount !== "number" || !Number.isFinite(item.price_amount)) return null;
  const currency = typeof item.price_currency === "string" && item.price_currency.trim().length > 0
    ? item.price_currency.trim().toUpperCase()
    : "CAD";
  return `${currency} ${item.price_amount.toFixed(2)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ partnerSlug: string; collectionSlug: string }>;
}): Promise<Metadata> {
  const { partnerSlug, collectionSlug } = await params;
  const result = await fetchPublicCollection({ partnerSlug, collectionSlug });

  if (result.status !== 200 || !result.payload?.collection?.name) {
    return {
      title: "Furniture Collection | Vibode",
      description: "Explore this Furniture Collection on Vibode.",
    };
  }

  const partnerName = result.payload.partner?.name?.trim() || "Vibode Partner";
  const collectionName = result.payload.collection.name.trim();
  const description =
    result.payload.collection.description?.trim() ||
    `Explore the ${collectionName} Furniture Collection from ${partnerName}.`;

  return {
    title: `${collectionName} | ${partnerName} | Vibode`,
    description,
  };
}

export default async function FurnitureCollectionLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ partnerSlug: string; collectionSlug: string }>;
  searchParams: Promise<{ returnTo?: string; folderId?: string }>;
}) {
  const { partnerSlug, collectionSlug } = await params;
  const query = await searchParams;
  const result = await fetchPublicCollection({ partnerSlug, collectionSlug });

  if (result.status === 404) notFound();
  if (result.status !== 200 || !result.payload || !result.payload.collection || !result.payload.partner) {
    notFound();
  }

  const payload = result.payload;
  const partner = payload.partner as PublicPartner;
  const collection = payload.collection as PublicCollection;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const showReturnToMyFurniture = query?.returnTo === "my-furniture";
  const returnHref = "/my-furniture";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12 space-y-8">
        {showReturnToMyFurniture ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={returnHref}
                className="inline-flex items-center text-sm text-slate-100 hover:text-emerald-200"
              >
                ← Return to My Furniture
              </Link>
              <p className="text-xs text-slate-400">You&apos;re viewing the original Furniture Collection.</p>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <RemoteImage
                src={partner.logo_url}
                alt={`${partner.name ?? "Partner"} logo`}
                className="h-12 w-12 rounded-lg border border-slate-700 bg-slate-900"
                placeholderLabel="Logo"
              />
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Furniture Partner</p>
                <h1 className="text-xl font-semibold">{partner.name ?? "Partner"}</h1>
              </div>
            </div>
            {partner.website_url ? (
              <a
                href={partner.website_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-emerald-400 hover:text-emerald-200"
              >
                Visit partner website
              </a>
            ) : null}
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Furniture Collection</p>
            <h2 className="text-2xl font-semibold tracking-tight">{collection.name ?? "Untitled Collection"}</h2>
            {collection.description ? (
              <p className="text-sm text-slate-300">{collection.description}</p>
            ) : (
              <p className="text-sm text-slate-400">Curated pieces selected for this Furniture Collection.</p>
            )}
          </div>
          <RemoteImage
            src={collection.hero_image_url}
            alt={`${collection.name ?? "Furniture Collection"} hero`}
            className="h-64 rounded-2xl border border-slate-800 bg-slate-900"
            placeholderLabel="No hero image"
          />
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Collection Items</h3>
          {items.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
              No active items are available in this Furniture Collection yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const title = item.product_name?.trim() || "Furniture item";
                const price = formatPrice(item);
                return (
                  <article
                    key={item.id ?? `${title}-${item.sort_order ?? 0}`}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3"
                  >
                    <RemoteImage
                      src={item.image_url}
                      alt={title}
                      className="h-44 w-full rounded-lg border border-slate-700 bg-slate-900"
                      placeholderLabel="Image unavailable"
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-100">{title}</p>
                      <p className="text-xs text-slate-400">
                        {item.brand?.trim() || "Unknown brand"}
                        {item.category?.trim() ? ` · ${item.category.trim()}` : ""}
                      </p>
                      {price ? <p className="text-sm text-emerald-200">{price}</p> : null}
                    </div>
                    {item.product_url ? (
                      <a
                        href={item.product_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs hover:border-emerald-400 hover:text-emerald-200"
                      >
                        View product
                      </a>
                    ) : (
                      <span className="inline-flex rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-500">
                        Product link unavailable
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
          <h4 className="text-lg font-semibold">Try these in your room</h4>
          <p className="text-sm text-slate-200">
            Open this collection in Vibode, upload your room, and see how these pieces could look in your
            space.
          </p>
          <div className="flex flex-wrap gap-3">
            <CollectionImportCta
              partnerSlug={partner.slug?.trim() || partnerSlug}
              collectionSlug={collection.slug?.trim() || collectionSlug}
            />
            <span className="text-xs text-slate-300">
              Start from Vibode home, then upload your room to continue.
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
