/**
 * The arithmetic of reading a PDF by scrolling: every page stacked down one
 * column, the reader's page read off how far down they are, and only the pages
 * near it drawn.
 *
 * Kept apart from the viewer so it can be tested without pdf.js or a laid-out
 * pane. Every position here is in pixels from the top of the stack of pages.
 */

/** The pages stacked down the column: where each starts and how tall its slot is. */
export interface PageStack {
  /** Where each page's slot starts, page 1 first. */
  tops: number[];
  /** How tall each page's slot is, the gap under the page included. */
  heights: number[];
  /** How tall the whole stack is. */
  total: number;
}

/** Stack pages of these heights, with `gap` under each. */
export function stackPages(pageHeights: number[], gap: number): PageStack {
  const tops: number[] = [];
  const heights: number[] = [];
  let total = 0;
  for (const height of pageHeights) {
    tops.push(total);
    heights.push(height + gap);
    total += height + gap;
  }
  return { tops, heights, total };
}

/** The page whose slot holds a point of the stack, held to the first and the last. */
function pageAt(stack: PageStack, y: number): number {
  const count = stack.tops.length;
  if (count === 0) return 1;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (stack.tops[middle] <= y) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** The pages any part of which is in the view, first to last. */
export function pagesInView(
  stack: PageStack,
  scrollTop: number,
  viewHeight: number,
): { first: number; last: number } {
  const first = pageAt(stack, Math.max(0, scrollTop));
  // The bottom edge itself belongs to the page below, which is not yet in view
  const last = pageAt(stack, Math.max(scrollTop, scrollTop + viewHeight - 1));
  return { first, last: Math.max(first, last) };
}

/**
 * How far down the view the line is whose page is the one being read: a
 * quarter of the way, so a page that has only just come up from the bottom
 * is not yet the reader's, and one whose last lines are still at the top is no
 * longer.
 */
export const READING_LINE = 0.25;

/**
 * The page the reader is on: the one under the reading line — or, scrolled to
 * the very end, the last one in view, since a short last page can never reach
 * the line and would otherwise be a page no scroll could arrive at.
 */
export function readingPage(stack: PageStack, scrollTop: number, viewHeight: number): number {
  const count = stack.tops.length;
  if (count === 0) return 1;
  if (scrollTop + viewHeight >= stack.total - 1) {
    return pagesInView(stack, scrollTop, viewHeight).last;
  }
  return pageAt(stack, scrollTop + viewHeight * READING_LINE);
}

/**
 * Where in the stack the view starts, as the page at its top and how far into
 * that page — what the view is held to when the pages around it change height
 * (a page drawn at its real size, the pane resized, a zoom).
 */
export interface ScrollAnchor {
  page: number;
  /** From 0 at the page's top to 1 at the bottom of its slot. */
  fraction: number;
}

export function anchorAt(stack: PageStack, scrollTop: number): ScrollAnchor {
  const page = pageAt(stack, Math.max(0, scrollTop));
  const height = stack.heights[page - 1] ?? 0;
  const into = scrollTop - (stack.tops[page - 1] ?? 0);
  return { page, fraction: height > 0 ? Math.min(1, Math.max(0, into / height)) : 0 };
}

/** Where the view starts for an anchor, in the stack as it is now. */
export function scrollTopOf(stack: PageStack, anchor: ScrollAnchor): number {
  const index = Math.min(Math.max(anchor.page, 1), stack.tops.length) - 1;
  if (index < 0) return 0;
  return stack.tops[index] + anchor.fraction * stack.heights[index];
}

/**
 * The pages to draw: those in view and `overscan` either side, so the next
 * one is drawn before the reader scrolls onto it. Every other page is a slot of
 * the right height with nothing drawn in it, which is what keeps a book of
 * hundreds of pages as light as one of a few.
 */
export function pagesToDraw(
  inView: { first: number; last: number },
  pageCount: number,
  overscan: number,
): number[] {
  const first = Math.max(1, inView.first - overscan);
  const last = Math.min(pageCount, inView.last + overscan);
  const pages: number[] = [];
  for (let page = first; page <= last; page++) pages.push(page);
  return pages;
}
