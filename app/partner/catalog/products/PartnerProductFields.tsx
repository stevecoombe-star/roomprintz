import { FIELD } from "./editor-ui";

export function PartnerProductFields(props: Readonly<{
  name: string;
  price: string;
  currency: string;
  imageUrl: string;
  productUrl: string;
  category: string;
  subcategory: string | null;
  collections: readonly Readonly<{
    collectionId: string;
    name: string;
    checked: boolean;
    pending: boolean;
  }>[];
  disabled: boolean;
  onNameChange: (value: string) => void;
  onNameCommit: () => void;
  onPriceChange: (value: string) => void;
  onPriceCommit: () => void;
  onImageChange: (value: string) => void;
  onImageCommit: () => void;
  onProductUrlChange: (value: string) => void;
  onProductUrlCommit: () => void;
  onCollectionToggle: (collectionId: string, checked: boolean) => void;
}>) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Product name
          <input
            className={FIELD}
            value={props.name}
            disabled={props.disabled}
            onChange={(event) => props.onNameChange(event.target.value)}
            onBlur={props.onNameCommit}
          />
        </label>
        <label className="block text-xs text-slate-400">
          {props.currency ? `Product price (${props.currency})` : "Product price"}
          <input
            className={FIELD}
            inputMode="decimal"
            value={props.price}
            disabled={props.disabled}
            onChange={(event) => props.onPriceChange(event.target.value)}
            onBlur={props.onPriceCommit}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Product image URL
          <input
            className={FIELD}
            value={props.imageUrl}
            disabled={props.disabled}
            onChange={(event) => props.onImageChange(event.target.value)}
            onBlur={props.onImageCommit}
          />
        </label>
        <label className="block text-xs text-slate-400 sm:col-span-2">
          Product page URL
          <input
            className={FIELD}
            value={props.productUrl}
            disabled={props.disabled}
            onChange={(event) => props.onProductUrlChange(event.target.value)}
            onBlur={props.onProductUrlCommit}
          />
        </label>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">Category</dt>
          <dd className="mt-1 text-slate-100">{props.category}</dd>
        </div>
        {props.subcategory ? (
          <div>
            <dt className="text-xs text-slate-400">Subcategory</dt>
            <dd className="mt-1 text-slate-100">{props.subcategory}</dd>
          </div>
        ) : null}
      </dl>
      <fieldset className="space-y-2" disabled={props.disabled}>
        <legend className="text-xs text-slate-400">Collections</legend>
        {props.collections.length === 0 ? (
          <p className="text-sm text-slate-400">No collections yet.</p>
        ) : props.collections.map((collection) => (
          <label key={collection.collectionId} className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={collection.checked}
              onChange={(event) => props.onCollectionToggle(collection.collectionId, event.target.checked)}
            />
            <span>{collection.name}</span>
            {collection.pending ? <span className="text-xs text-slate-400">Not published yet</span> : null}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
