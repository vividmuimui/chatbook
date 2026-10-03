import {
  MAX_BOOK_SEARCH_MATCHES,
  type BookSearchMatch,
  type BookSearchResult,
} from "../../shared/schemas/bookSearch";

/** How much of the page is shown on either side of a match, in characters. */
export const SNIPPET_CONTEXT_LENGTH = 40;

/**
 * Text as it is compared, with where each of its characters came from.
 *
 * Three things are taken out of the comparison:
 *
 * - **Whitespace, all of it** — not just folded to one space. The text was
 *   extracted from a laid-out page, and pdf.js ends a line wherever the page
 *   did; for Japanese that is wherever the line filled up, mid-word as often as
 *   not, so "日本\n語" is the word 日本語. Folding runs to one space would still
 *   miss it. The cost is that "foo bar" also finds "foobar", which a reader
 *   typing a space between two words is unlikely to be surprised by. The page
 *   is marked by the same rule (`locateQuoteInSpans` drops whitespace too), so
 *   whatever is found here can be found on the drawn page.
 * - **Case**, wherever lowering a character keeps its length (ASCII, and the
 *   full-width and other alphabets with a one-to-one lower case). The few that
 *   grow when lowered are left as they are, so every character still maps back
 *   to one place in the page.
 * - **Composition**: both sides are NFC already, so が typed as か + ゛ finds
 *   the が in the book.
 */
function searchable(text: string): { text: string; origins: number[] } {
  let folded = "";
  const origins: number[] = [];
  let index = 0;
  for (const char of text) {
    if (!/\s/.test(char)) {
      const lower = char.toLowerCase();
      const kept = lower.length === char.length ? lower : char;
      folded += kept;
      for (let unit = 0; unit < kept.length; unit++) origins.push(index + unit);
    }
    index += char.length;
  }
  return { text: folded, origins };
}

/** The page's own text around a match, with its whitespace folded for display. */
function context(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Every place the words are in the book, page by page, up to `limit`.
 *
 * `fullText` is the pages — or an EPUB's chapters — joined with a form feed, as
 * the client extracted them. Pages are searched one at a time, so a match never
 * runs on from the foot of one page to the head of the next: there would be no
 * one page to send the reader to. Matches on a page do not overlap; the search
 * picks up where the last match ended.
 *
 * Pure, so it is tested without a database (`bookTextSearch.test.ts`).
 */
export function findInBookText(
  fullText: string,
  query: string,
  limit: number = MAX_BOOK_SEARCH_MATCHES,
): BookSearchResult {
  const needle = searchable(query.normalize("NFC")).text;
  const matches: BookSearchMatch[] = [];
  if (needle === "") return { matches, truncated: false };

  const pages = fullText.normalize("NFC").split("\f");
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const haystack = searchable(page);

    for (
      let at = haystack.text.indexOf(needle);
      at >= 0;
      at = haystack.text.indexOf(needle, at + needle.length)
    ) {
      // One more than the limit is how the answer knows it was cut off,
      // rather than having come out at exactly that many.
      if (matches.length === limit) return { matches, truncated: true };

      const start = haystack.origins[at];
      const end = haystack.origins[at + needle.length - 1] + 1;
      matches.push({
        pageNumber: i + 1,
        before: context(page.slice(Math.max(0, start - SNIPPET_CONTEXT_LENGTH), start)),
        match: page.slice(start, end),
        after: context(page.slice(end, end + SNIPPET_CONTEXT_LENGTH)),
      });
    }
  }

  return { matches, truncated: false };
}
