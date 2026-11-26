"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { VibodeButton, type VibodeButtonSize, type VibodeButtonVariant } from "@/components/ui/VibodeButton";
import { VibodeIconButton } from "@/components/ui/VibodeIconButton";

const CANONICAL_TOKENS = [
  ["White", "--brand-white"],
  ["Warm White", "--brand-warm-white"],
  ["Charcoal", "--brand-charcoal"],
  ["Deep Teal", "--brand-deep-teal"],
  ["Sand Gold", "--brand-sand-gold"],
] as const;

const PROVISIONAL_TOKENS = [["Destructive support", "--support-danger"]] as const;

const VARIANTS: Array<{ variant: VibodeButtonVariant; label: string }> = [
  { variant: "primary", label: "Start New Room" },
  { variant: "secondary", label: "Generate" },
  { variant: "outline", label: "Harmonize" },
  { variant: "tertiary", label: "Cancel" },
  { variant: "destructive", label: "Delete Room" },
  { variant: "tool", label: "Move" },
];

const SIZES: Array<{ size: VibodeButtonSize; label: string; detail: string }> = [
  { size: "compact", label: "Catalog", detail: "32px compact" },
  { size: "standard", label: "My Furniture", detail: "40px standard" },
  { size: "large", label: "Apply", detail: "44px large" },
];

const TOOLS = [
  ["move", "Move"],
  ["rotate", "Rotate"],
  ["size", "Size"],
] as const;

type ToolName = (typeof TOOLS)[number][0];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {children}
    </svg>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M9 4v10M4 9h10" />
    </Icon>
  );
}

function UndoIcon() {
  return (
    <Icon>
      <path d="M7 6 4 9l3 3" />
      <path d="M4 9h7a3 3 0 0 1 0 6H9" />
    </Icon>
  );
}

function RedoIcon() {
  return (
    <Icon>
      <path d="M11 6l3 3-3 3" />
      <path d="M14 9H7a3 3 0 0 0 0 6h2" />
    </Icon>
  );
}

function GridIcon() {
  return (
    <Icon>
      <path d="M4 4h4v4H4zM10 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4z" />
    </Icon>
  );
}

function MoveIcon() {
  return (
    <Icon>
      <path d="M9 4v10M4 9h10" />
    </Icon>
  );
}

function RotateIcon() {
  return (
    <Icon>
      <path d="M13 6.5A5 5 0 1 0 14 11" />
      <path d="M13 3.5v3h-3" />
    </Icon>
  );
}

function SizeIcon() {
  return (
    <Icon>
      <path d="M4 8V4h4M14 10v4h-4" />
    </Icon>
  );
}

const ICON_TOOLS = [
  ["move", "Move", MoveIcon],
  ["rotate", "Rotate", RotateIcon],
  ["size", "Size", SizeIcon],
] as const;

const EMPTY_COLORS: Record<string, string> = {};
let cachedColors: Record<string, string> | null = null;

function colorSnapshot(): Record<string, string> {
  if (cachedColors) return cachedColors;
  const next: Record<string, string> = {};
  for (const [, variable] of [...CANONICAL_TOKENS, ...PROVISIONAL_TOKENS]) {
    next[variable] = resolvedColor(variable);
  }
  cachedColors = next;
  return cachedColors;
}

function subscribeToColors() {
  return () => {};
}

function resolvedColor(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!match) return value.trim();
  const hex = [match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex.toUpperCase()}`;
}

function TokenSwatch({ name, variable, value }: { name: string; variable: string; value: string }) {
  return (
    <figure className="min-w-0" data-token={variable}>
      <div
        className="h-16 rounded-[8px] border border-ink-secondary"
        style={{ backgroundColor: `var(${variable})` }}
      />
      <figcaption className="mt-2">
        <span className="block text-sm font-semibold text-ink">{name}</span>
        <span className="block text-xs text-ink-secondary">{variable}</span>
        <span className="block font-mono text-xs text-ink" data-resolved-color={variable}>
          {value || "Reading the stylesheet"}
        </span>
      </figcaption>
    </figure>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-section={id} className="space-y-4">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DesignStudio() {
  const colors = useSyncExternalStore(subscribeToColors, colorSnapshot, () => EMPTY_COLORS);
  const [clicks, setClicks] = useState(0);
  const [tool, setTool] = useState<ToolName>("move");
  const [formResult, setFormResult] = useState("No form event yet.");
  const [toolbarNote, setToolbarNote] = useState("No toolbar action yet.");
  const [iconTool, setIconTool] = useState<ToolName>("move");
  const [iconNote, setIconNote] = useState("No icon tool yet.");

  function recordClick() {
    setClicks((count) => count + 1);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roomName = String(new FormData(event.currentTarget).get("roomName") ?? "").trim();
    setFormResult(roomName ? `Submitted “${roomName}”.` : "Submitted an empty room name.");
  }

  return (
    <main className="min-h-screen bg-canvas-warm text-ink">
      <div className="mx-auto w-full max-w-6xl space-y-10 px-6 py-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold text-ink-secondary">Vibode</p>
          <h1 className="text-3xl font-semibold">Design Studio</h1>
          <p className="max-w-3xl rounded-[8px] border border-ink-secondary bg-canvas px-4 py-3 text-sm font-semibold">
            Development only. This page certifies button primitives. It is not a product screen. Button Design System V1.0 visuals are owner-approved. Accessibility certification and product adoption remain open.
          </p>
        </header>

        <Section id="palette" title="Brand palette">
          <p className="max-w-3xl text-sm text-ink-secondary">
            Canonical swatches read the centralized stylesheet properties. The values below are computed from those properties.
          </p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {CANONICAL_TOKENS.map(([name, variable]) => (
              <TokenSwatch key={variable} name={name} variable={variable} value={colors[variable] ?? ""} />
            ))}
          </div>
          <div className="space-y-3 rounded-[8px] border border-dashed border-ink-secondary p-4">
            <h3 className="text-sm font-semibold">Supporting status colour</h3>
            <p className="max-w-3xl text-sm text-ink-secondary">
              Destructive support is an approved status colour. It is not one of the five canonical brand colours. Hover, pressed, and focus treatments stay the existing derived tokens.
            </p>
            <div className="grid max-w-xs grid-cols-1 gap-4">
              {PROVISIONAL_TOKENS.map(([name, variable]) => (
                <TokenSwatch key={variable} name={name} variable={variable} value={colors[variable] ?? ""} />
              ))}
            </div>
          </div>
        </Section>

        <Section id="certification" title="Buttons — current defaults">
          <p className="max-w-3xl text-sm text-ink-secondary">
            These are the approved V1.0 button primitives. The labels here are examples, not product action assignments. Accessibility certification is still open.
          </p>
          <div className="flex flex-wrap gap-3">
            {VARIANTS.map(({ variant, label }) => (
              <VibodeButton key={variant} variant={variant} onClick={recordClick}>
                {label}
              </VibodeButton>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {SIZES.map(({ size, label, detail }) => (
              <div key={size} className="space-y-2">
                <p className="text-xs text-ink-secondary">{detail}</p>
                <VibodeButton size={size} onClick={recordClick}>
                  {label}
                </VibodeButton>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <VibodeButton onClick={recordClick}>
              <span className="inline-flex size-4 items-center justify-center [&_svg]:h-full [&_svg]:w-full">
                <PlusIcon />
              </span>
              Start New Room
            </VibodeButton>
            <VibodeIconButton label="Catalog" onClick={recordClick}>
              <GridIcon />
            </VibodeIconButton>
            <VibodeIconButton label="My Furniture" onClick={recordClick}>
              <PlusIcon />
            </VibodeIconButton>
            <VibodeButton disabled onClick={recordClick}>
              Generate
            </VibodeButton>
            <VibodeButton variant="destructive" disabled onClick={recordClick}>
              Delete Room
            </VibodeButton>
          </div>
          <div className="flex flex-wrap gap-3">
            <VibodeButton variant="tool" selected onClick={recordClick}>
              Move
            </VibodeButton>
            <VibodeButton variant="outline" selected={false} onClick={recordClick}>
              Rotate
            </VibodeButton>
          </div>
        </Section>

        <Section id="exploration" title="Design exploration — experiments, not defaults">
          <p className="max-w-3xl text-sm text-ink-secondary">
            These local overrides are not approved alternatives. They do not change the V1.0 defaults shown above.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-[8px] border border-ink-secondary p-4" style={{ backgroundColor: "var(--brand-white)" }} data-experiment="surface-white">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — White surface</p>
              <VibodeButton>Start New Room</VibodeButton>
            </div>
            <div className="space-y-3 rounded-[8px] border border-ink-secondary p-4" style={{ backgroundColor: "var(--brand-warm-white)" }} data-experiment="surface-warm-white">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — Warm White surface</p>
              <VibodeButton>Start New Room</VibodeButton>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:border-transparent" data-experiment="border-none">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — no border</p>
              <VibodeButton>Apply</VibodeButton>
              <p className="text-xs text-ink">
                Sand Gold against White without a border is below the 3:1 edge threshold. A borderless treatment is not approved.
              </p>
            </div>
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:border-ink-secondary" data-experiment="border-deep-teal">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — Deep Teal border</p>
              <VibodeButton>Apply</VibodeButton>
              <p className="text-xs text-ink">This matches the approved 1px Deep Teal border.</p>
            </div>
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:border-ink" data-experiment="border-charcoal">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — Charcoal border</p>
              <VibodeButton>Apply</VibodeButton>
              <p className="text-xs text-ink">Local override for comparison. It is not the component default.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:rounded-[4px]" data-experiment="radius-4">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — 4px radius</p>
              <VibodeButton>Catalog</VibodeButton>
            </div>
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:rounded-[8px]" data-experiment="radius-8">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — 8px radius</p>
              <VibodeButton>Catalog</VibodeButton>
              <p className="text-xs text-ink">This matches the approved 8px radius.</p>
            </div>
            <div className="space-y-3 rounded-[8px] bg-canvas p-4 [&_button]:rounded-[12px]" data-experiment="radius-12">
              <p className="text-xs font-semibold text-ink-secondary">Experiment — 12px radius</p>
              <VibodeButton>Catalog</VibodeButton>
            </div>
          </div>
        </Section>

        <Section id="interaction" title="Interaction certification">
          <div className="max-w-3xl space-y-2 text-sm text-ink">
            <p>Use Tab and Shift+Tab to move between controls. Enter and Space activate the focused button.</p>
            <p>A disabled control can take focus and must not run its action. Ordinary action buttons do not expose a pressed state. The selected tool does.</p>
            <p>
              To check reduced motion, turn on Reduce Motion and reload this page. Button colour changes should happen immediately, without the 150ms transition.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <VibodeButton data-demo="enabled-action" onClick={recordClick}>
              Start New Room
            </VibodeButton>
            <VibodeButton data-demo="disabled-action" disabled onClick={recordClick}>
              Generate
            </VibodeButton>
            <p data-demo="click-count">Enabled clicks: {clicks}</p>
          </div>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Tool selection demonstration">
            {TOOLS.map(([value, label]) => (
              <VibodeButton
                key={value}
                variant={tool === value ? "tool" : "outline"}
                selected={tool === value}
                data-demo={`tool-${value}`}
                onClick={() => setTool(value)}
              >
                {label}
              </VibodeButton>
            ))}
          </div>
          <p data-demo="selected-tool">Selected tool: {tool}</p>
          <form className="flex max-w-xl flex-wrap items-end gap-3" onSubmit={onSubmit} onReset={() => setFormResult("Form reset.")}>
            <label className="space-y-1 text-sm">
              <span>Room name</span>
              <input
                name="roomName"
                defaultValue="Living room"
                className="block h-10 rounded-[8px] border border-ink-secondary bg-canvas px-3 text-ink"
              />
            </label>
            <VibodeButton type="submit">Apply</VibodeButton>
            <VibodeButton type="reset" variant="tertiary">
              Cancel
            </VibodeButton>
            <VibodeButton type="submit" variant="secondary" disabled>
              Generate
            </VibodeButton>
          </form>
          <p data-demo="form-result">{formResult}</p>
        </Section>

        <Section id="toolbar" title="Compact toolbar simulation">
          <p className="max-w-3xl text-sm text-ink-secondary">
            These controls use the real 32px compact size and local demonstration state. They are not connected to STAGE.
          </p>
          <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-canvas p-3" role="toolbar" aria-label="Compact toolbar demonstration">
            <VibodeIconButton label="Undo" size="compact" onClick={() => setToolbarNote("Undo demonstration")}>
              <UndoIcon />
            </VibodeIconButton>
            <VibodeIconButton label="Redo" size="compact" onClick={() => setToolbarNote("Redo demonstration")}>
              <RedoIcon />
            </VibodeIconButton>
            <VibodeButton size="compact" onClick={() => setToolbarNote("Room scale demonstration")}>
              Room Scale
            </VibodeButton>
            {TOOLS.map(([value, label]) => (
              <VibodeButton
                key={value}
                size="compact"
                variant={tool === value ? "tool" : "outline"}
                selected={tool === value}
                onClick={() => {
                  setTool(value);
                  setToolbarNote(`${label} selected`);
                }}
              >
                {label}
              </VibodeButton>
            ))}
          </div>
          <p data-demo="toolbar-note">{toolbarNote}</p>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-secondary">Experiment — 28px height, not the component default</p>
            <div className="flex flex-wrap items-center gap-2" data-experiment="toolbar-28">
              <div className="[&_button]:size-[28px]">
                <VibodeIconButton label="Undo" size="compact">
                  <UndoIcon />
                </VibodeIconButton>
              </div>
              <div className="[&_button]:h-[28px]">
                <VibodeButton size="compact">Room Scale</VibodeButton>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-secondary">Comparison — 40px standard size, not the compact toolbar default</p>
            <div className="flex flex-wrap items-center gap-2" data-experiment="toolbar-40">
              <VibodeIconButton label="Undo" size="standard">
                <UndoIcon />
              </VibodeIconButton>
              <VibodeButton size="standard">Room Scale</VibodeButton>
            </div>
          </div>
        </Section>

        <Section id="icon-selection" title="Selected icon-only controls">
          <p className="max-w-3xl text-sm text-ink-secondary">
            These are real icon buttons with local demonstration state. The selected mark sits under the glyph. Choosing a tool does not change STAGE.
          </p>
          {SIZES.map(({ size, detail }) => (
            <div key={size} className="space-y-2">
              <p className="text-xs text-ink-secondary">{detail}</p>
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={`${size} icon tool selection`}
                data-demo={`icon-tools-${size}`}
              >
                {ICON_TOOLS.map(([value, label, Glyph]) => (
                  <VibodeIconButton
                    key={value}
                    label={label}
                    size={size}
                    variant={iconTool === value ? "tool" : "outline"}
                    selected={iconTool === value}
                    data-demo={`icon-tool-${size}-${value}`}
                    onClick={() => {
                      setIconTool(value);
                      setIconNote(`${label} selected`);
                    }}
                  >
                    <Glyph />
                  </VibodeIconButton>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <VibodeIconButton
              label="Pinned tool"
              size="standard"
              variant="tool"
              selected
              disabled
              data-demo="icon-tool-disabled"
              onClick={() => setIconNote("Disabled icon activated")}
            >
              <GridIcon />
            </VibodeIconButton>
            <p data-demo="icon-tool-note">{iconNote}</p>
          </div>
        </Section>

        <p className="text-sm text-ink-secondary">
          Future sections, not built here: typography, elevation, and form fields.
        </p>
      </div>
    </main>
  );
}
