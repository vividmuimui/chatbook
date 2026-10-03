import { z } from "zod";

/**
 * Searching the book's own text — its pages, or an EPUB's chapters — for words
 * the reader typed, as opposed to searching the highlight list
 * (`selection.ts`'s `selectionSearch*`), which looks through what was marked
 * and said about it.
 */

/** Long enough for a sentence pasted back in, short enough to bound the scan. */
export const MAX_BOOK_SEARCH_QUERY_LENGTH = 200;

/**
 * The most matches one search answers with.
 *
 * A word as common as "the" is on every page of a technical book; past a couple
 * of hundred the list is no longer something a reader goes through one by one,
 * and the answer says it was cut off so the reader can narrow the words instead.
 */
export const MAX_BOOK_SEARCH_MATCHES = 200;

export const bookSearchQuerySchema = z.object({
  // Trimmed before the length is checked, so a query of spaces alone is refused
  // rather than answered with nothing.
  q: z.string().trim().min(1).max(MAX_BOOK_SEARCH_QUERY_LENGTH),
});

/**
 * One place the words were found, cut into three so the reader can be shown
 * which part matched without the client searching the snippet again.
 *
 * `match` is the book's own text, not the query: it is what is marked on the
 * page, and it can differ from what was typed in case and spacing. `before` and
 * `after` are the text around it on the same page, with runs of whitespace
 * folded to one space, and are what tells two matches on one page apart when
 * the mark is placed.
 */
export const bookSearchMatchSchema = z.object({
  pageNumber: z.number().int().positive(),
  before: z.string(),
  match: z.string(),
  after: z.string(),
});

export type BookSearchMatch = z.infer<typeof bookSearchMatchSchema>;

export const bookSearchResultSchema = z.object({
  matches: z.array(bookSearchMatchSchema),
  /** Whether there were more matches than `MAX_BOOK_SEARCH_MATCHES`. */
  truncated: z.boolean(),
});

export type BookSearchResult = z.infer<typeof bookSearchResultSchema>;
