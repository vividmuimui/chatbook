import type { HighlightColor } from "../../shared/schemas/selection";
import { HIGHLIGHT_CHOICES } from "../lib/highlightColors";

interface ColorSwatchesProps {
  /** Each button's accessible name, from the colour's name: what pressing it does. */
  labelOf: (name: string) => string;
  onPick: (color: HighlightColor) => void;
  /**
   * The colour currently chosen, for swatches that pick rather than act. Left
   * out, no swatch is pressed: each one does its thing at once.
   */
  selected?: string;
  disabled?: boolean;
  /** Dark surfaces (the bar along the bottom) want a lighter ring. */
  tone?: "light" | "dark";
}

/**
 * The four highlight colours as a row of buttons.
 *
 * 44px targets, the size a thumb can hit: the same row is what a phone gets in
 * the bar and in the list inside the sheet. Never shown on hover alone, for
 * the same reason.
 */
export function ColorSwatches({
  labelOf,
  onPick,
  selected,
  disabled = false,
  tone = "light",
}: ColorSwatchesProps) {
  return (
    <div className="flex items-center">
      {HIGHLIGHT_CHOICES.map(({ value, name }) => {
        const pressed = selected === undefined ? undefined : selected === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={labelOf(name)}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onPick(value)}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: value }}
              className={`block h-6 w-6 rounded-full ${
                pressed
                  ? tone === "dark"
                    ? "ring-2 ring-white ring-offset-2 ring-offset-gray-900"
                    : "ring-2 ring-gray-700 ring-offset-2"
                  : tone === "dark"
                    ? "ring-1 ring-white/40"
                    : "ring-1 ring-black/10"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
