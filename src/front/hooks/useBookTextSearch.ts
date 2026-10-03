import { useCallback, useState } from "react";
import { useAtom } from "jotai";
import useSWR from "swr";
import { fetcher } from "../lib/fetcher";
import { bookSearchTermAtom } from "../atoms/bookSearchAtom";
import { bookSearchResultSchema, type BookSearchResult } from "../../shared/schemas/bookSearch";

/** Asks where in a book's text a query is. */
export type SearchBookText = (pdfId: string, query: string) => Promise<BookSearchResult>;

const findKey = (pdfId: string, query: string) =>
  `/api/pdf/${pdfId}/find?q=${encodeURIComponent(query)}`;

export const requestBookTextSearch: SearchBookText = (pdfId, query) =>
  fetcher(findKey(pdfId, query), bookSearchResultSchema);

/**
 * What the reader is looking for in the book's text, and where it is.
 *
 * The same shape as the highlight list's search (`useHighlightSearch`), for the
 * same reason: nothing goes to the server until `submit`, since a half-typed
 * Japanese word is not a search. What was submitted is held in an atom rather
 * than here, so the panel can be folded away and brought back to the results it
 * showed.
 */
export function useBookTextSearch(
  pdfId: string | undefined,
  search: SearchBookText = requestBookTextSearch,
) {
  const [term, setTerm] = useAtom(bookSearchTermAtom);
  /** As typed, starting from what was last searched for. */
  const [query, setQuery] = useState(term);

  const submit = useCallback(() => setTerm(query.trim()), [query, setTerm]);

  const searching = pdfId !== undefined && term !== "";
  const { data, error, isLoading } = useSWR(searching ? findKey(pdfId, term) : null, () =>
    search(pdfId as string, term),
  );

  return {
    query,
    setQuery,
    /** Runs the search for whatever is in the box; an empty box clears it. */
    submit,
    /** Where the words are, or undefined while nothing has come back. */
    result: searching ? data : undefined,
    isSearching: isLoading,
    searchError: searching && error instanceof Error ? error.message : undefined,
  };
}
