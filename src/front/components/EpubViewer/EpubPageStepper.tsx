import { useAtomValue, useSetAtom } from "jotai";
import { currentPageAtom } from "../../atoms/pdfAtom";
import { epubScreenAtom, shownScreen, turnEpubAtom } from "../../atoms/epubAtom";
import { turnEpub, turnForSide, type ReadingDirection } from "../../lib/epubPaging";
import { ChevronIcon } from "../PdfViewer/PageStepper";

/** Apple and Android both put the floor for a tappable control here. */
const TAP_TARGET = "h-11 min-w-11";

interface EpubPageStepperProps {
  pageCount: number;
  /** Which way the book opens, which decides which chevron is on. */
  direction?: ReadingDirection;
}

/**
 * `PageStepper` for a book read a screen at a time: the same two chevrons,
 * turning a screen rather than a page, with the chapter the reader is in and
 * how far through it they are between them.
 *
 * In the same two places `PageStepper` is: under the page on a wide screen, and
 * in the toolbar of the one column (`PageToolbar`'s `stepper`).
 */
export function EpubPageStepper({ pageCount, direction = "ltr" }: EpubPageStepperProps) {
  const page = useAtomValue(currentPageAtom);
  const at = useAtomValue(epubScreenAtom);
  const turn = useSetAtom(turnEpubAtom);
  const { screen, count } = shownScreen(at, page);

  const chevron = (side: "left" | "right") => {
    const way = turnForSide(side, direction);
    return (
      <button
        type="button"
        aria-label={way === "next" ? "次のページ" : "前のページ"}
        disabled={turnEpub({ page, screen, count }, way, pageCount) === null}
        onClick={() => turn({ turn: way, pageCount })}
        className={`${TAP_TARGET} cursor-pointer rounded-lg text-gray-600 disabled:cursor-default disabled:opacity-30`}
      >
        <ChevronIcon direction={side} />
      </button>
    );
  };

  return (
    <>
      {chevron("left")}
      {/* Two lines in the height of one control: the chapter, which is the
          book's own page and what the outline and the address name, over the
          screen of it, which is the reader's. */}
      <span className="flex flex-col items-center leading-tight text-gray-600 tabular-nums">
        <span className="text-sm">
          {page} / {pageCount} 章
        </span>
        <span className="text-[11px] text-gray-500">
          {screen + 1} / {count}
        </span>
      </span>
      {chevron("right")}
    </>
  );
}
