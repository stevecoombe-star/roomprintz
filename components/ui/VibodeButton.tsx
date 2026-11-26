import type { ComponentProps } from "react";

/**
 * Reusable native button for later Vibode screens.
 *
 * Sizes are provisional until owner visual review:
 * - compact is 32px. It meets the 24px WCAG 2.2 minimum and is below the
 *   44px enhanced target. Use it for a labeled toolbar control with a pointer
 *   or keyboard, not as the only primary action on a page. Its 12px label is
 *   a short control name, not body copy.
 * - standard is 40px.
 * - large is 44px and is the size for a standalone primary action.
 *
 * The primary Deep Teal border is provisional. It exists so Sand Gold can
 * keep a visible edge on White. Selected state sets aria-pressed only when
 * `selected` is passed. Its non-colour cue is an underline on a labelled
 * button, or a short mark under the glyph on an icon button. Neither cue
 * changes the control's size or runs along its boundary.
 * Destructive state uses a 2px border as its non-colour shape cue.
 *
 * The focus ring uses Charcoal and is intended for a light canvas. These
 * primitives are not mounted on dark photography yet. Disabled controls use
 * the native disabled attribute, so the browser does not activate them.
 */

export const VIBODE_BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "tertiary",
  "destructive",
  "tool",
] as const;

export const VIBODE_BUTTON_SIZES = ["compact", "standard", "large"] as const;

export type VibodeButtonVariant = (typeof VIBODE_BUTTON_VARIANTS)[number];
export type VibodeButtonSize = (typeof VIBODE_BUTTON_SIZES)[number];

type NativeButtonProps = Omit<ComponentProps<"button">, "type">;

export type VibodeButtonProps = NativeButtonProps & {
  variant?: VibodeButtonVariant;
  size?: VibodeButtonSize;
  type?: "button" | "submit" | "reset";
  /**
   * Omit for an ordinary action. Pass true or false only for a control that
   * toggles. That is the only case that sets aria-pressed.
   */
  selected?: boolean;
};

const BASE_CLASS = [
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2",
  "whitespace-nowrap rounded-[8px] border-solid font-semibold leading-none",
  "transition-colors duration-150 ease-out motion-reduce:transition-none",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const VARIANT_CLASS: Record<VibodeButtonVariant, string> = {
  primary: [
    "border bg-action text-action-ink border-action-border",
    "hover:bg-action-hover active:bg-action-pressed",
    "disabled:hover:bg-action disabled:active:bg-action",
  ].join(" "),
  secondary: [
    "border border-transparent bg-action-secondary text-action-secondary-ink",
    "hover:bg-action-secondary-hover active:bg-action-secondary-pressed",
    "disabled:hover:bg-action-secondary disabled:active:bg-action-secondary",
  ].join(" "),
  outline: [
    "border border-ink-secondary bg-canvas text-ink-secondary",
    "hover:bg-quiet-hover active:bg-quiet-pressed",
    "disabled:hover:bg-canvas disabled:active:bg-canvas",
  ].join(" "),
  tertiary: [
    "border border-transparent bg-transparent text-ink-secondary",
    "hover:bg-quiet-hover active:bg-quiet-pressed",
    "disabled:hover:bg-transparent disabled:active:bg-transparent",
  ].join(" "),
  destructive: [
    "border-2 border-danger-border bg-danger text-danger-ink",
    "hover:bg-danger-hover active:bg-danger-pressed",
    "disabled:hover:bg-danger disabled:active:bg-danger",
  ].join(" "),
  tool: [
    "border border-transparent bg-tool text-tool-ink",
    "hover:bg-tool-hover active:bg-tool-pressed",
    "disabled:hover:bg-tool disabled:active:bg-tool",
  ].join(" "),
};

const SIZE_CLASS: Record<VibodeButtonSize, string> = {
  compact: "h-8 px-2.5 text-xs",
  standard: "h-10 px-3.5 text-sm",
  large: "h-11 px-4 text-sm",
};

const ICON_SIZE_CLASS: Record<VibodeButtonSize, string> = {
  compact: "size-8 px-0",
  standard: "size-10 px-0",
  large: "size-11 px-0",
};

const SELECTED_TEXT_CLASS = "underline decoration-2 underline-offset-[3px]";

const SELECTED_ICON_CLASS = [
  "relative",
  "after:pointer-events-none",
  "after:absolute",
  "after:top-[calc(50%+0.5em+2px)]",
  "after:left-1/2",
  "after:h-[2px]",
  "after:w-[14px]",
  "after:-translate-x-1/2",
  "after:rounded-full",
  "after:bg-current",
  "after:content-['']",
].join(" ");

export function vibodeButtonClassName({
  variant = "primary",
  size = "standard",
  selected = false,
  iconOnly = false,
  className,
}: {
  variant?: VibodeButtonVariant;
  size?: VibodeButtonSize;
  selected?: boolean;
  iconOnly?: boolean;
  className?: string;
}): string {
  return [
    BASE_CLASS,
    VARIANT_CLASS[variant],
    iconOnly ? ICON_SIZE_CLASS[size] : SIZE_CLASS[size],
    selected ? (iconOnly ? SELECTED_ICON_CLASS : SELECTED_TEXT_CLASS) : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

type VibodeButtonElementProps = VibodeButtonProps & {
  iconOnly?: boolean;
};

export function VibodeButtonElement({
  variant = "primary",
  size = "standard",
  type = "button",
  selected,
  iconOnly = false,
  className,
  disabled,
  ref,
  children,
  ...rest
}: VibodeButtonElementProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      data-selected={selected === undefined ? undefined : String(selected)}
      aria-pressed={selected === undefined ? rest["aria-pressed"] : selected}
      className={vibodeButtonClassName({
        variant,
        size,
        selected: selected === true,
        iconOnly,
        className,
      })}
    >
      {children}
    </button>
  );
}

export function VibodeButton(props: VibodeButtonProps) {
  return <VibodeButtonElement {...props} />;
}
