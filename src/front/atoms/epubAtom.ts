import { atom } from "jotai";
import { currentPageAtom } from "./pdfAtom";
import { turnEpub, type EpubPlace } from "../lib/epubPaging";
import type { PageTurn } from "../lib/touchNavigation";

/**
 * The screen of the chapter the reader is on, and how many the chapter fills.
 *
 * The reader's alone, like the chapter it is in (`currentPageAtom`), but never
 * stored or put in the address: the screens a chapter is cut into depend on the
 * window and the type, so a screen number means nothing anywhere else.
 *
 * `page` names the chapter this was laid out for. Whatever moves the reader to
 * another chapter — the outline, a citation, the address — only writes
 * `currentPageAtom`, and a chapter this does not name is read from its first
 * screen; `EpubViewer` lays the new chapter out and writes this again. Only a
 * turn writes both, which is how one back from the first screen of a chapter
 * lands on the last screen of the chapter before (`screen: "last"`).
 */
export interface EpubScreen extends EpubPlace {
  /** How many screens the chapter `page` names fills, as last laid out. */
  count: number;
}

export const epubScreenAtom = atom<EpubScreen>({ page: 0, screen: 0, count: 1 });

/** The screen to show of the chapter the reader is on, as `epubScreenAtom` reads for it. */
export function shownScreen(
  at: EpubScreen,
  currentPage: number,
): { screen: number; count: number } {
  if (at.page !== currentPage) return { screen: 0, count: 1 };
  const last = Math.max(0, at.count - 1);
  return { screen: at.screen === "last" ? last : Math.min(at.screen, last), count: at.count };
}

/**
 * One screen on or back, into the next or previous chapter at either end of
 * this one. Every way of turning an EPUB comes here: the keys, the edges of the
 * screen, a swipe, and the chevrons below the page or in the toolbar.
 */
export const turnEpubAtom = atom(
  null,
  (get, set, { turn, pageCount }: { turn: PageTurn; pageCount: number }) => {
    const page = get(currentPageAtom);
    const at = get(epubScreenAtom);
    const to = turnEpub({ page, ...shownScreen(at, page) }, turn, pageCount);
    if (!to) return;

    set(epubScreenAtom, { ...to, count: to.page === page ? at.count : 1 });
    if (to.page !== page) set(currentPageAtom, to.page);
  },
);
