import { ColorSwatches } from "../ColorSwatches";
import type { HighlightColor } from "../../../shared/schemas/selection";

interface SelectionActionBarProps {
  /** The passage the reader has settled on, shown back to them. */
  quote: string;
  onAsk: () => void;
  /** Opens the box for a note rather than a question ("メモ": the bar has no room for more on a phone). */
  onNote: () => void;
  /** Keeps the passage as a highlight in this colour, and asks nothing. */
  onMark: (color: HighlightColor) => void;
  onDismiss: () => void;
  /** While a mark is being stored, so a second tap does not store it twice. */
  marking?: boolean;
}

/**
 * What a passage held down on a touch screen offers, along the bottom of the
 * page rather than floating over it.
 *
 * The wide layout puts the question box straight onto the passage, where a
 * mouse left it. A finger cannot: the box would land under the reader's own
 * hand, next to the platform's own selection menu, and take the keyboard with
 * it before anyone has said they want to type. So the offer comes first, in one
 * fixed place, and the box only follows if it is taken.
 *
 * Marking in a colour is the one offer that needs no box at all, so its four
 * swatches act at once — none of them takes the focus, and the selection the
 * reader may still be widening stays where it is until one is tapped.
 *
 * The passage is quoted back because a phone's selection is easy to get wrong
 * by a word, and this is where that shows before a highlight is stored.
 */
export function SelectionActionBar({
  quote,
  onAsk,
  onNote,
  onMark,
  onDismiss,
  marking = false,
}: SelectionActionBarProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 bg-gray-900 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(19,26,41,0.3)]">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-gray-200">{`“${quote}”`}</p>
        <button
          type="button"
          aria-label="選択をやめる"
          onClick={onDismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-5 w-5 fill-none stroke-current stroke-[1.7]"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {/* A second row: four 44px swatches beside the two words leave the
          quote no room on a phone. */}
      <div className="flex items-center gap-1">
        <ColorSwatches
          labelOf={(name) => `${name}でマーク`}
          onPick={onMark}
          disabled={marking}
          tone="dark"
        />
        <button
          type="button"
          onClick={onNote}
          disabled={marking}
          className="ml-auto h-11 shrink-0 rounded-lg px-3 text-sm text-gray-100 disabled:opacity-50"
        >
          メモ
        </button>
        <button
          type="button"
          onClick={onAsk}
          disabled={marking}
          className="h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          AIに質問
        </button>
      </div>
    </div>
  );
}
