import type { PageTurn } from "./touchNavigation";

/**
 * How a chapter of an EPUB is cut into the screens it is read a screen at a
 * time in, as a Kindle reads it.
 *
 * The cutting itself is the browser's: the chapter is laid out in CSS columns
 * as tall as the window, one column (or two, side by side) to a screen, and the
 * screen is moved along them. What is here is the arithmetic around that — how
 * wide a screen is, how many the columns fill, which one a point of the chapter
 * is on, and where a turn leads — kept apart so it can be tested without a
 * layout engine.
 *
 * A screen is the reader's alone. Everywhere else — the server, the excerpt a
 * question is asked about, citations, the place kept for the reader, the
 * outline — the chapter is still the page.
 */

/**
 * The widest a screen is laid out at, its margins included: the width the
 * chapter's page had (`max-w-2xl`) when it was read by scrolling. Wider, the
 * lines are longer than an eye follows comfortably.
 */
export const MAX_SCREEN_WIDTH_PX = 672;

/**
 * The narrowest each of two screens side by side is allowed to be. A pane with
 * room for two of these shows a spread; one with less shows one screen.
 */
export const SPREAD_MIN_SCREEN_WIDTH_PX = 440;

/** Which way the book opens, which is which way the screens run. */
export type ReadingDirection = "ltr" | "rtl";

export type ScreenSide = "left" | "right";

export interface PagedLayout {
  /** Screens side by side: 2 is a spread. */
  columns: 1 | 2;
  /** The width all of them take together, which is how far one turn moves. */
  viewWidth: number;
}

/** How the chapter is laid out in a pane of this width. */
export function pagedLayout(paneWidth: number): PagedLayout {
  const width = Math.max(0, Math.floor(paneWidth));
  const columns = width >= SPREAD_MIN_SCREEN_WIDTH_PX * 2 ? 2 : 1;
  const viewWidth = Math.min(width, MAX_SCREEN_WIDTH_PX * columns);
  // Two screens of the same whole width, so the columns land on the same
  // pixels each turn rather than drifting by half of one.
  return { columns, viewWidth: viewWidth - (viewWidth % columns) };
}

/**
 * How many screens the chapter's columns fill.
 *
 * `scrollWidth` is the chapter's laid out in columns: every column and the gaps
 * between them, which is the screens it takes short of the margins outside the
 * first and the last — never as much as a whole column, so rounding up past a
 * pixel of slack counts the columns.
 */
export function screenCount(scrollWidth: number, layout: PagedLayout): number {
  const columnStep = layout.viewWidth / layout.columns;
  if (columnStep <= 0 || scrollWidth <= 0) return 1;
  const columns = Math.max(1, Math.ceil((scrollWidth - 1) / columnStep));
  return Math.ceil(columns / layout.columns);
}

/**
 * The screen a point of the chapter is drawn on, from how far it is from the
 * chapter's left edge as laid out (before the chapter is moved along to the
 * screen being read).
 */
export function screenOfX(x: number, viewWidth: number): number {
  if (viewWidth <= 0) return 0;
  return Math.max(0, Math.floor(x / viewWidth));
}

/** Where in the book a screen is: a chapter, and the screen of it. */
export interface EpubPlace {
  page: number;
  /**
   * The screen of the chapter, counted from 0. "last" is the end of a chapter
   * that has not been laid out yet — where turning back from the next one lands.
   */
  screen: number | "last";
}

/**
 * Where a turn leads: the next or previous screen, on into the next chapter
 * from the last screen of one, back into the end of the previous chapter from
 * the first. Null past either end of the book.
 */
export function turnEpub(
  at: { page: number; screen: number; count: number },
  turn: PageTurn,
  pageCount: number,
): EpubPlace | null {
  if (turn === "next") {
    if (at.screen < at.count - 1) return { page: at.page, screen: at.screen + 1 };
    if (at.page < pageCount) return { page: at.page + 1, screen: 0 };
    return null;
  }
  if (at.screen > 0) return { page: at.page, screen: at.screen - 1 };
  if (at.page > 1) return { page: at.page - 1, screen: "last" };
  return null;
}

/**
 * Which way a side of the screen turns: the one place a left or a right — an
 * edge tapped, a swipe, an arrow key, a chevron — is read as back or on.
 *
 * A book that opens to the right (vertical Japanese, manga) reads on to the
 * left.
 */
export function turnForSide(side: ScreenSide, direction: ReadingDirection = "ltr"): PageTurn {
  const onward: ScreenSide = direction === "rtl" ? "left" : "right";
  return side === onward ? "next" : "prev";
}

/**
 * The side of the screen a turn was asked for on, by a reading of the gesture
 * that takes the book to open to the left — what `resolveTapZone` and
 * `resolveSwipe` give back.
 */
export function sideOfLtrTurn(turn: PageTurn): ScreenSide {
  return turn === "next" ? "right" : "left";
}

/**
 * The first index whose value is at or past `target`, by halving — the values
 * rising with the index. An index with no value (a character with nothing
 * drawn) stands for the next one that has one; past the end when nothing
 * reaches `target`.
 */
export function firstIndexAtOrAfter(
  length: number,
  valueAt: (index: number) => number | null,
  target: number,
): number {
  const valueFrom = (index: number) => {
    for (let i = index; i < length; i++) {
      const value = valueAt(i);
      if (value !== null) return value;
    }
    return null;
  };

  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const value = valueFrom(middle);
    if (value === null || value >= target) high = middle;
    else low = middle + 1;
  }
  return low;
}
