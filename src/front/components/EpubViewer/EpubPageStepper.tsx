import { useAtomValue, useSetAtom } from "jotai";
import { currentPageAtom } from "../../atoms/pdfAtom";
import {
  epubProgressAtom,
  epubScreenAtom,
  shownScreen,
  turnEpubAtom,
  turnEpubChapterAtom,
} from "../../atoms/epubAtom";
import { readingModeAtom } from "../../atoms/settingsAtom";
import { turnChapter, turnEpub } from "../../lib/epubPaging";
import { turnToward, type ScreenSide } from "../../lib/touchNavigation";
import type { PageDirection } from "../../../shared/schemas/book";
import { ChevronIcon } from "../PdfViewer/PageStepper";

/** Apple and Android both put the floor for a tappable control here. */
const TAP_TARGET = "h-11 min-w-11";

interface EpubPageStepperProps {
  pageCount: number;
  /** Which way the book opens, which decides which chevron is on. */
  direction?: PageDirection;
}

/**
 * `PageStepper` for a book read a screen at a time: the same two chevrons,
 * turning a screen rather than a page, with where the reader is between them —
 * as a Kindle says it: the heading of the contents they are under, how far into
 * the book that is, and the screen of the chapter they are on.
 *
 * Not the chapter's number: a chapter here is an item of the book's spine
 * (`epub.ts`), which is how the file is cut rather than how the book is — one
 * item can hold a whole chapter of five sections, the next only its title
 * page — so "9 / 17" told the reader nothing they could use.
 *
 * In the same two places `PageStepper` is: under the page on a wide screen, and
 * in the toolbar of the one column (`PageToolbar`'s `stepper`).
 *
 * Read by scrolling, the chevrons move a chapter at a time — the scroll moves
 * through the chapter, so there is no screen to count or turn.
 */
export function EpubPageStepper({ pageCount, direction = "ltr" }: EpubPageStepperProps) {
  const page = useAtomValue(currentPageAtom);
  const at = useAtomValue(epubScreenAtom);
  const turnScreen = useSetAtom(turnEpubAtom);
  const turnChapterTo = useSetAtom(turnEpubChapterAtom);
  const scrolling = useAtomValue(readingModeAtom) === "scroll";
  const progress = useAtomValue(epubProgressAtom);
  const { screen, count } = shownScreen(at, page);
  const turn = scrolling ? turnChapterTo : turnScreen;
  const canTurn = (way: "next" | "prev") =>
    scrolling
      ? turnChapter(page, way, pageCount) !== null
      : turnEpub({ page, screen, count }, way, pageCount) !== null;

  const chevron = (side: ScreenSide) => {
    const way = turnToward(side, direction);
    return (
      <button
        type="button"
        aria-label={
          scrolling
            ? way === "next"
              ? "次の章へ"
              : "前の章へ"
            : way === "next"
              ? "次のページ"
              : "前のページ"
        }
        disabled={!canTurn(way)}
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
      {/* Two lines in the height of one control: the heading, which gives way
          first in a toolbar a thumb's width short, over how far into the book
          and the screen of the chapter. Without contents, the second alone. */}
      <span className="flex min-w-0 max-w-64 shrink flex-col items-center leading-tight text-gray-600 tabular-nums">
        {progress?.section ? (
          <span className="max-w-full truncate text-xs" title={progress.section}>
            {progress.section}
          </span>
        ) : null}
        <span className="flex gap-2 whitespace-nowrap text-[11px] text-gray-500">
          {progress ? <span>{progress.percent}%</span> : null}
          {scrolling ? null : (
            <span>
              この章 <span>{`${screen + 1} / ${count}`}</span>
            </span>
          )}
        </span>
      </span>
      {chevron("right")}
    </>
  );
}
