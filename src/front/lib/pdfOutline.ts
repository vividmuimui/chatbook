// pdf.js is only ever named as a type here: the document comes in as an
// argument, so no value import exists to smuggle in a non-legacy build past
// pdfjsConfig.ts.
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  MAX_OUTLINE_CHAPTERS,
  MAX_OUTLINE_TITLE_LENGTH,
  type BookChapter,
  type BookOutline,
} from "../../shared/schemas/book";

export interface OutlineEntry {
  title: string;
  /** null when the destination cannot be resolved to a page */
  pageNumber: number | null;
  children: OutlineEntry[];
  /**
   * EPUB only: the id in the chapter the entry points at (`ch7.xhtml#sec3`'s
   * `sec3`). A chapter is one page of the book, and a book that puts several
   * sections in one chapter tells them apart only by this.
   */
  anchor?: string;
  /**
   * EPUB only: where in its chapter's text the entry starts, once the chapter
   * has been read (`epubProgress.ts` の `mapEpubBook`). Absent, the entry
   * starts with its chapter.
   */
  offset?: number;
}

/**
 * The entry a reader is currently inside: the last one that starts at or
 * before where they are.
 *
 * Where they are is a page, and for an EPUB a place in the text of that page
 * (its chapter) as well: a chapter that holds sections 7.1 to 7.5 is one page,
 * so the page alone would light up all five — or, the ties going to the later
 * entry, always the last. A PDF says nothing past the page, so every entry on
 * it counts as reached.
 *
 * The entry itself rather than its title: a book that calls two sections
 * 「はじめに」 — one under every chapter is how technical books are written —
 * would otherwise mark them both as the place being read.
 */
export function findActiveEntry(
  entries: OutlineEntry[],
  currentPage: number,
  currentOffset = Number.POSITIVE_INFINITY,
): OutlineEntry | null {
  let active: OutlineEntry | null = null;
  /** Whether an entry starts at or before another, with "nothing chosen yet" before all. */
  const notAfter = (one: OutlineEntry, other: OutlineEntry | null) =>
    other === null ||
    other.pageNumber === null ||
    one.pageNumber! > other.pageNumber ||
    (one.pageNumber === other.pageNumber && (one.offset ?? 0) >= (other.offset ?? 0));
  const reached = (entry: OutlineEntry) =>
    entry.pageNumber !== null &&
    (entry.pageNumber < currentPage ||
      (entry.pageNumber === currentPage && (entry.offset ?? 0) <= currentOffset));

  for (const entry of entries) {
    // Ties go to the later entry, which is the one the reader has reached.
    if (reached(entry) && notAfter(entry, active)) active = entry;

    const withinChildren = findActiveEntry(entry.children, currentPage, currentOffset);
    if (withinChildren && notAfter(withinChildren, active)) active = withinChildren;
  }
  return active;
}

type RawOutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

/**
 * Resolve an outline destination to a 1-based page number.
 * A destination is either a name that has to be looked up, or an explicit
 * array whose first element is a page reference.
 */
async function resolvePageNumber(
  doc: PDFDocumentProxy,
  dest: RawOutlineItem["dest"],
): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    return (
      (await doc.getPageIndex(explicit[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1
    );
  } catch {
    // One bookmark pointing at nothing is not a broken table of contents: the
    // entry is listed without a page and cannot be jumped to, while the rest
    // of the outline stays usable.
    return null;
  }
}

async function toEntries(doc: PDFDocumentProxy, items: RawOutlineItem[]): Promise<OutlineEntry[]> {
  return Promise.all(
    items.map(async (item) => ({
      title: item.title,
      pageNumber: await resolvePageNumber(doc, item.dest),
      children: item.items?.length ? await toEntries(doc, item.items as RawOutlineItem[]) : [],
    })),
  );
}

/**
 * Read the PDF's bookmarks (table of contents) and resolve each entry to a
 * page. Returns an empty array for PDFs that ship without an outline; a read
 * that fails rejects, and what that means is the caller's to decide (the
 * outline panel reports it, the upload path shrugs it off).
 */
export async function readOutlineEntries(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const items = await doc.getOutline();
  return items ? await toEntries(doc, items) : [];
}

/**
 * The shape the server stores: top-level chapters only, each with the page it
 * starts on. Chapter bounds are all the server cuts chat excerpts by, so the
 * nesting stays client-side. Entries whose destination never resolved carry
 * no page and are dropped; when nothing survives, null — the book is stored
 * as having no outline and chat falls back to a page window. An outline past
 * the server's limits is clamped to them here — it refuses one with a 400 on
 * the whole upload, and no table of contents is worth the book.
 */
export function toStoredOutline(entries: OutlineEntry[]): BookOutline | null {
  const chapters = entries
    .filter((entry): entry is OutlineEntry & { pageNumber: number } => entry.pageNumber !== null)
    .map(({ title, pageNumber }) => ({
      title: title.slice(0, MAX_OUTLINE_TITLE_LENGTH),
      pageNumber,
    }))
    .slice(0, MAX_OUTLINE_CHAPTERS);
  return chapters.length > 0 ? chapters : null;
}

/**
 * The book's stored chapters as entries the outline panel lists, for a PDF
 * with no bookmarks of its own — one whose table of contents the model made.
 *
 * Top-level only, as stored. The span ahead of the first chapter is the server
 * tiling the book for the chat's scope menu, not a heading, so it is left out.
 */
export function chaptersAsOutline(chapters: BookChapter[]): OutlineEntry[] {
  return chapters
    .filter((chapter): chapter is BookChapter & { title: string } => chapter.title !== null)
    .map(({ title, startPage }) => ({ title, pageNumber: startPage, children: [] }));
}
