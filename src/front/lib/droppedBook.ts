/**
 * What a drop on the shelf turned out to be carrying.
 *
 * `none` and `refused` are kept apart because they are different events to the
 * reader: dragging a text selection over the shelf carries no files at all and
 * is not a mistake, while dropping a photo is one and has to say so.
 */
export type DroppedBook =
  | { kind: "book"; file: File }
  | { kind: "refused"; reason: string }
  | { kind: "none" };

/** The types a browser gives the two formats the shelf takes in. */
const BOOK_TYPES = new Set(["application/pdf", "application/epub+zip"]);

/** Whether the browser, or failing that the name, calls this a PDF or an EPUB. */
function isBook(file: File): boolean {
  // Some file managers hand over a drop with no type at all, so the extension
  // is the fallback rather than the other way round. Which of the two it is,
  // is read off the bytes later (`extractBookData`).
  return BOOK_TYPES.has(file.type) || /\.(pdf|epub)$/i.test(file.name);
}

/** Picks the single book out of a drop, or says why there is none to open. */
export function pickDroppedBook(files: readonly File[]): DroppedBook {
  if (files.length === 0) return { kind: "none" };
  // One at a time: the shelf leaves for the book it just took in, so a second
  // file would have nowhere to be opened.
  if (files.length > 1) return { kind: "refused", reason: "一度に追加できる本は1冊です" };

  const [file] = files;
  if (!isBook(file)) return { kind: "refused", reason: "PDFかEPUBのファイルだけを追加できます" };
  return { kind: "book", file };
}
