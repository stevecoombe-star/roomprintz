import type { ReactNode } from "react";

import {
  VibodeButtonElement,
  type VibodeButtonProps,
  type VibodeButtonSize,
} from "./VibodeButton";

/**
 * Icon-only control. `label` is required and becomes the accessible name.
 * The icon is hidden from assistive technology so it cannot replace that name.
 * A selected icon button uses the approved mark under the glyph.
 */

export type VibodeIconButtonProps = Omit<VibodeButtonProps, "children" | "aria-label"> & {
  label: string;
  children: ReactNode;
};

const GLYPH_CLASS: Record<VibodeButtonSize, string> = {
  compact: "size-4",
  standard: "size-[18px]",
  large: "size-[18px]",
};

export function VibodeIconButton({
  label,
  children,
  size = "standard",
  ...props
}: VibodeIconButtonProps) {
  const accessibleName = label.trim();
  if (accessibleName.length === 0) {
    throw new Error("VibodeIconButton requires a non-empty accessible name.");
  }

  return (
    <VibodeButtonElement {...props} size={size} iconOnly aria-label={accessibleName}>
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full ${GLYPH_CLASS[size]}`}
      >
        {children}
      </span>
    </VibodeButtonElement>
  );
}
