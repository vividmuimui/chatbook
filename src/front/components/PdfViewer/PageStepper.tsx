import { useAtom } from "jotai";
import { currentPageAtom } from "../../atoms/pdfAtom";
import { turnTo } from "../../lib/spread";
import { turnToward, type PageTurn, type ScreenSide } from "../../lib/touchNavigation";
import type { PageDirection } from "../../../shared/schemas/book";

/** Apple and Android both put the floor for a tappable control here. */
const TAP_TARGET = "h-11 min-w-11";

const TURN_LABELS: Record<PageTurn, string> = {
  prev: "前のページ",
  next: "次のページ",
};

interface PageStepperProps {
  pageCount: number;
  /**
   * How many pages are up at once, which is also how far a step moves them.
   *
   * One unless the caller says otherwise: the one column layout has room for a
   * single page whatever else it does.
   */
  step?: number;
  /**
   * Which way the book's pages turn. The step on sits on the side the next
   * page is on — the left, in a book that opens on the right.
   */
  direction?: PageDirection;
}

/**
 * A step back, where the reader is, and a step on.
 *
 * The same three controls wherever they are shown, sized for the thumb that
 * wants them. Two places show them, and they are chosen on different grounds:
 * the one column always holds them at the bottom of the window (`PageToolbar`,
 * on width alone), while the two panes only keep them under the page where the
 * device cannot hover (`PdfViewer`) — a pointer there turns pages at the edges
 * of the page and with h / l.
 *
 * The page is read from its atom rather than passed in, since the keyboard
 * shortcuts and the edges of the page write the same one.
 */
export function PageStepper({ pageCount, step = 1, direction = "ltr" }: PageStepperProps) {
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom);

  // Where each control leads, asked of the same arithmetic the edges of the
  // page and the keyboard turn by. A control that leads nowhere is the one
  // that is spent: at the end of the book, and at the start of it.
  const leadsTo = (turn: PageTurn) => turnTo(currentPage, turn, pageCount, step);
  // Named in the order the book counts them, whichever side of the spread
  // each is drawn on: "7-8" is where the reader is in a book of either kind.
  const lastUp = Math.min(pageCount, currentPage + step - 1);

  const stepButton = (side: ScreenSide) => {
    const turn = turnToward(side, direction);
    const to = leadsTo(turn);
    return (
      <button
        type="button"
        aria-label={TURN_LABELS[turn]}
        disabled={to === currentPage}
        onClick={() => setCurrentPage(to)}
        className={`${TAP_TARGET} cursor-pointer rounded-lg text-gray-600 disabled:cursor-default disabled:opacity-30`}
      >
        <ChevronIcon direction={side} />
      </button>
    );
  };

  return (
    <>
      {stepButton("left")}

      {/* No padding of its own: the 44px each button reserves around its
          chevron is already the room between them, and adding to it pulls the
          three apart into three things instead of one control. */}
      <span className="text-sm text-gray-600 tabular-nums">
        {lastUp > currentPage ? `${currentPage}-${lastUp}` : currentPage} / {pageCount}
      </span>

      {stepButton("right")}
    </>
  );
}

function ChevronIcon({ direction }: { direction: ScreenSide }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mx-auto h-5 w-5 fill-none stroke-current stroke-[1.7]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
