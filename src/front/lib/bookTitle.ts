/** A file name without its `.pdf` / `.epub`. */
export function titleOf(fileName: string): string {
  return fileName.replace(/\.(pdf|epub)$/i, "");
}

/**
 * What a book is called wherever it is shown: the title the reader gave it, or
 * — never renamed, or renamed back — the one its file name makes.
 *
 * The one place the two are chosen between, so the shelf, the reader's header
 * and the deletion's wording never disagree about a book's name.
 */
export function bookTitle(book: { fileName: string; title: string | null }): string {
  return book.title ?? titleOf(book.fileName);
}
