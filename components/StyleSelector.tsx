// components/StyleSelector.tsx
"use client";

export type RoomStyleId =
  | "modern-luxury"
  | "japandi"
  | "scandinavian"
  | "coastal"
  | "urban-loft"
  | "farmhouse";

export type RoomStyle = {
  id: RoomStyleId;
  name: string;
  subtitle: string;
  description: string;
};

export const ROOM_STYLES: RoomStyle[] = [
  {
    id: "modern-luxury",
    name: "Modern Luxury",
    subtitle: "Marble, gold accents, rich textures",
    description: "High-end finishes, elegant neutrals, and curated statement pieces.",
  },
  {
    id: "japandi",
    name: "Japandi Clean",
    subtitle: "Minimal, serene, light woods",
    description: "Soft, balanced spaces that feel calm, warm, and inviting.",
  },
  {
    id: "scandinavian",
    name: "Scandinavian Minimal",
    subtitle: "Cozy, functional, airy",
    description: "Light woods, soft textiles, and clutter-free presentation.",
  },
  {
    id: "coastal",
    name: "Coastal Bright",
    subtitle: "Fresh, light, beach-adjacent",
    description: "White walls, soft blues, and natural textures for a breezy feel.",
  },
  {
    id: "urban-loft",
    name: "Urban Loft",
    subtitle: "Industrial, bold, modern lines",
    description: "Concrete, metal, and sleek furniture for city-forward listings.",
  },
  {
    id: "farmhouse",
    name: "Farmhouse Chic",
    subtitle: "Warm, rustic, lived-in",
    description: "Earthy tones, wood, and comfortable textures your buyers will love.",
  },
];

type StyleSelectorProps = {
  styles: RoomStyle[];
  selectedStyle: RoomStyleId | null;
  onSelectStyle: (styleId: RoomStyleId) => void;
};

export function StyleSelector({
  styles,
  selectedStyle,
  onSelectStyle,
}: StyleSelectorProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">2. Choose Staging Style</h2>
          <p className="text-xs text-slate-400">
            Pick the interior design theme that best matches your listing.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {styles.map((style) => {
          const isSelected = style.id === selectedStyle;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => onSelectStyle(style.id)}
              className={[
                "text-left rounded-xl border px-3 py-2 transition",
                "bg-slate-950/60 hover:bg-slate-900",
                isSelected
                  ? "border-emerald-400/80 shadow-[0_0_0_1px_rgba(45,212,191,0.3)]"
                  : "border-slate-800",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{style.name}</div>
                  <div className="text-[11px] text-slate-400">{style.subtitle}</div>
                </div>
                {isSelected && (
                  <span className="text-[11px] text-emerald-300 border border-emerald-400/60 rounded-full px-2 py-[2px]">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{style.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
