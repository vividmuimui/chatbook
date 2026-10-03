import type { ShelfGroup } from "./shelfGroups";

/**
 * How far into a book the reader has got, as a whole percentage — or `null`
 * for a book never opened in a reader, which the shelf marks apart rather than
 * calling 0%.
 *
 * Rounded down, so 100 means the last page and nothing short of it: rounding
 * to nearest would call page 199 of 200 finished. A saved page outside the book
 * (one stored again shorter than it was) is held to it.
 */
export function readingPercent(lastReadPage: number | null, pageCount: number): number | null {
  if (lastReadPage === null) return null;
  const page = Math.min(Math.max(lastReadPage, 0), pageCount);
  return Math.floor((page / pageCount) * 100);
}

/**
 * How far the reader has got in an entry: its furthest-read book.
 *
 * An entry is one title in several files, and the reader reads the title, not
 * a file — the EPUB on the phone, the PDF at the desk. Whichever has got
 * further is how much of the title they have read; an average would pull a
 * finished book down for the copy they never needed to open. The share is
 * compared rather than the page, since an EPUB counts chapters and a PDF pages.
 * Files still waiting in Dropbox have no place saved and say nothing.
 */
export function groupProgress(group: ShelfGroup): number | null {
  let furthest: number | null = null;
  for (const member of group.members) {
    if (member.kind !== "book") continue;
    const percent = readingPercent(member.book.lastReadPage, member.book.pageCount);
    if (percent !== null && (furthest === null || percent > furthest)) furthest = percent;
  }
  return furthest;
}
