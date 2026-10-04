import type { EpubChapter } from "./epub";
import { EPUB_ID_PREFIX, renderChapter } from "./epubContent";
import { findActiveEntry, type OutlineEntry } from "./pdfOutline";

/**
 * Where a reader is in an EPUB, in the terms a reader has for it.
 *
 * The app counts an EPUB's pages as the items of its spine (`epub.ts`), which is
 * how the file is cut, not how the book is: one item can hold a whole chapter
 * with five sections in it, another only a title page. "9 / 17" says nothing a
 * reader can use. What a Kindle says instead is how far into the book they are
 * — a share of its text — and which heading of the contents they are under, and
 * that is worked out here: from how much text each item holds, and where in its
 * item each entry of the contents starts.
 */
export interface EpubBookMap {
  /** How many characters each chapter's drawn text holds, in reading order. */
  chapterLengths: number[];
  /**
   * The table of contents, each entry with where in its chapter's text it
   * starts (`OutlineEntry.offset`) when it names a place in the chapter.
   */
  outline: OutlineEntry[];
}

/**
 * How many characters of a drawn chapter's text come before an element of it,
 * by the id the book gave it — or null when the chapter has no such element.
 *
 * Counted the way a highlight's offsets are (`epubTextRange.ts`): over the text
 * nodes under the chapter element, so an entry and a passage are placed on the
 * same scale.
 */
export function anchorOffset(root: Element, anchor: string): number | null {
  const id = `${EPUB_ID_PREFIX}${anchor}`;
  const target = Array.from(root.querySelectorAll("[id]")).find((element) => element.id === id);
  if (!target) return null;
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEndBefore(target);
  return before.toString().length;
}

/**
 * Read every chapter once for what the reader's place is measured against.
 *
 * The chapters are rebuilt as the viewer builds them (`renderChapter`) but
 * never put in the document: only their text is wanted, and where in it the
 * entries' anchors fall. An anchor the chapter does not have leaves its entry at
 * the top of the chapter, which is where following it lands too.
 */
export function mapEpubBook(chapters: EpubChapter[], outline: OutlineEntry[]): EpubBookMap {
  const drawn = chapters.map((chapter) =>
    renderChapter(chapter.source, chapter.path, { imageUrl: () => null }),
  );

  const chapterLengths = drawn.map((root) => root.textContent?.length ?? 0);
  /** Every entry made here, in the order the contents list them, with where it was found. */
  const listed: { entry: OutlineEntry; found: number | null }[] = [];

  const place = (entries: OutlineEntry[]): OutlineEntry[] =>
    entries.map((entry) => {
      const root = entry.pageNumber !== null ? drawn[entry.pageNumber - 1] : undefined;
      const placed: OutlineEntry = { ...entry, children: [] };
      listed.push({
        entry: placed,
        found: root && entry.anchor ? anchorOffset(root, entry.anchor) : 0,
      });
      placed.children = place(entry.children);
      return placed;
    });
  const placed = place(outline);

  // An anchor the chapter has no element for — an id on an element the chapter
  // was rebuilt without — is placed no earlier than the entries listed before
  // it: just ahead of the next one that was found in the same chapter, or at
  // its end. At the top of the chapter instead, it would count as reached all
  // through the chapter and take the mark from the section really being read.
  const next = new Map<number, number>();
  for (let i = listed.length - 1; i >= 0; i--) {
    const { entry, found } = listed[i];
    const page = entry.pageNumber;
    if (page === null) continue;
    const offset = found ?? next.get(page) ?? chapterLengths[page - 1] ?? 0;
    if (found !== null) next.set(page, found);
    if (offset > 0) entry.offset = offset;
  }

  return { chapterLengths, outline: placed };
}

/**
 * How far into the book a place is, as a whole percentage of its text.
 *
 * Rounded down, as the shelf's share of a book read is (`readingPercent`): 100
 * is the very end and nothing short of it. A book with no text at all is at 0.
 */
export function bookPercent(chapterLengths: number[], page: number, offset: number): number {
  const total = chapterLengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return 0;
  const index = Math.min(Math.max(page, 1), chapterLengths.length) - 1;
  const before = chapterLengths.slice(0, index).reduce((sum, length) => sum + length, 0);
  const within = Math.min(Math.max(offset, 0), chapterLengths[index] ?? 0);
  return Math.floor(((before + within) / total) * 100);
}

/** How far into the book an entry of the contents starts. */
export function entryPercent(map: EpubBookMap, entry: OutlineEntry & { pageNumber: number }) {
  return bookPercent(map.chapterLengths, entry.pageNumber, entry.offset ?? 0);
}

/** What the reader is told about where they are. */
export interface EpubProgress {
  /** How far into the book's text, in whole percent. */
  percent: number;
  /** The heading of the contents they are under, or null for a book without one (or before it). */
  section: string | null;
}

/** Where a place in the book is, said as `EpubProgress`. */
export function epubProgress(map: EpubBookMap, page: number, offset: number): EpubProgress {
  return {
    percent: bookPercent(map.chapterLengths, page, offset),
    section: findActiveEntry(map.outline, page, offset)?.title ?? null,
  };
}
