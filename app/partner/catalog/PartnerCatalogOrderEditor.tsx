"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { movePartnerCatalogProduct } from "@/lib/vibode-stage/partner-catalog-order";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";

export type PartnerCatalogOrderItem = Readonly<{
  productId: string;
  name: string;
  status?: "active" | "inactive";
}>;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function PartnerCatalogOrderEditor(props: Readonly<{
  products: readonly PartnerCatalogOrderItem[];
  refreshCatalog?: () => void;
}>) {
  const initialIds = props.products.map((product) => product.productId);
  const signature = initialIds.join("\n");
  const [order, setOrder] = useState<readonly string[]>(initialIds);
  const [saved, setSaved] = useState<readonly string[]>(initialIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderRef = useRef<readonly string[]>(initialIds);
  const savedRef = useRef<readonly string[]>(initialIds);
  const draggingRef = useRef<string | null>(null);
  const droppedRef = useRef(false);
  const busyRef = useRef(false);
  const names = useMemo(
    () => new Map(props.products.map((product) => [product.productId, product])),
    [props.products],
  );

  useEffect(() => {
    const ids = signature.length > 0 ? signature.split("\n") : [];
    orderRef.current = ids;
    savedRef.current = ids;
    setOrder(ids);
    setSaved(ids);
  }, [signature]);

  async function persistOrder(next: readonly string[]) {
    if (busyRef.current || sameIds(next, savedRef.current)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vibode/partner/catalog/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: next }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        orderRef.current = savedRef.current;
        setOrder([...savedRef.current]);
        setError(body?.error ?? "The catalog order could not be saved.");
        return;
      }
      const committed = [...next];
      savedRef.current = committed;
      setSaved(committed);
      props.refreshCatalog?.();
    } catch {
      orderRef.current = savedRef.current;
      setOrder([...savedRef.current]);
      setError("The catalog order could not be saved.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function previewMove(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const draggingId = draggingRef.current;
    if (!draggingId || draggingId === targetId || busyRef.current) return;
    const current = orderRef.current;
    const from = current.indexOf(draggingId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const afterMidpoint = event.clientY > bounds.top + bounds.height / 2;
    if (to > from && !afterMidpoint) return;
    if (to < from && afterMidpoint) return;
    const next = movePartnerCatalogProduct(current, from, to);
    orderRef.current = next;
    setOrder(next);
  }

  function moveByKey(productId: string, direction: -1 | 1) {
    if (busyRef.current) return;
    const current = orderRef.current;
    const from = current.indexOf(productId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = movePartnerCatalogProduct(current, from, to);
    orderRef.current = next;
    setOrder(next);
    void persistOrder(next);
  }

  if (props.products.length < 2) return null;

  return (
    <section aria-labelledby="catalog-order-heading" className="space-y-3 rounded-xl border border-slate-800 p-4">
      <div>
        <h3 id="catalog-order-heading" className="text-sm font-medium text-slate-100">Catalog order</h3>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Drag to set the manual order used in your catalog. Sorting by name does not change it.
          Focus a handle and use the arrow keys to move a product.
        </p>
      </div>
      <ol aria-label="Manual catalog order" aria-busy={busy} className="space-y-2">
        {order.map((productId) => {
          const product = names.get(productId);
          if (!product) return null;
          return (
            <li
              key={productId}
              className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              onDragOver={(event) => previewMove(event, productId)}
              onDrop={(event) => {
                event.preventDefault();
                droppedRef.current = true;
                void persistOrder(orderRef.current);
              }}
            >
              <button
                type="button"
                draggable={!busy}
                aria-label={`Reorder ${product.name}`}
                aria-keyshortcuts="ArrowUp ArrowDown"
                className={`cursor-grab rounded-md px-1.5 py-1 text-slate-400 hover:text-slate-100 active:cursor-grabbing ${FOCUS}`}
                onDragStart={(event) => {
                  draggingRef.current = productId;
                  droppedRef.current = false;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", productId);
                }}
                onDragEnd={() => {
                  const dropped = droppedRef.current;
                  droppedRef.current = false;
                  draggingRef.current = null;
                  if (!dropped) {
                    orderRef.current = savedRef.current;
                    setOrder([...savedRef.current]);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  moveByKey(productId, event.key === "ArrowUp" ? -1 : 1);
                }}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{product.name}</span>
              {product.status === "inactive" ? (
                <span className="shrink-0 text-xs text-slate-400">Inactive</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      <p className="sr-only" aria-live="polite">{busy ? "Saving catalog order" : `Manual order saved for ${saved.length} products`}</p>
    </section>
  );
}
