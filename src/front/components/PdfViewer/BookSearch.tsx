import { useCallback } from "react";
import { useAtom, useSetAtom } from "jotai";
import { bookSearchOpenAtom } from "../../atoms/bookSearchAtom";
import { citedPassageAtom, currentPageAtom } from "../../atoms/pdfAtom";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { useBookTextSearch, type SearchBookText } from "../../hooks/useBookTextSearch";
import { isSubmitKey } from "../../lib/isSubmitKey";
import type { BookSearchMatch, BookSearchResult } from "../../../shared/schemas/bookSearch";

interface BookSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  /** Where the words are, or undefined while nothing has been searched for or come back. */
  result: BookSearchResult | undefined;
  isSearching: boolean;
  /** Why the search could not be run, as the server or the network put it. */
  searchError: string | undefined;
  onPick: (match: BookSearchMatch) => void;
}

/**
 * The search through the book's text: a box, and the places the words are, by
 * page, with the words themselves marked in the text around them.
 *
 * Reads no data source of its own, as the highlight list does not, so how it
 * looks can be tested with the answer in hand.
 */
export function BookSearchPanel({
  query,
  onQueryChange,
  onSearch,
  result,
  isSearching,
  searchError,
  onPick,
}: BookSearchPanelProps) {
  return (
    <section
      aria-label="本文の検索"
      className="flex h-full w-72 max-w-[85vw] shrink-0 flex-col border-r border-gray-200 bg-white"
    >
      {/* One row, so a phone keeps most of its height for the results. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2">
        <input
          type="search"
          aria-label="本文から探す語"
          placeholder="本文を検索"
          value={query}
          // Opened to type into: the toggle, the toolbar and `/` all mean that.
          autoFocus
          onChange={(e) => onQueryChange(e.target.value)}
          // Not the Enter that confirms a Japanese word, which is the IME's:
          // searching there would run on half a phrase.
          onKeyDown={(e) => {
            if (isSubmitKey(e.nativeEvent as unknown as KeyboardEvent)) {
              e.preventDefault();
              onSearch();
            }
          }}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          aria-label="本文を検索"
          onClick={onSearch}
          className="shrink-0 cursor-pointer rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
        >
          検索
        </button>
      </div>

      {searchError !== undefined ? (
        <p role="alert" className="m-2 rounded-md bg-red-50 p-3 text-xs text-red-600">
          本文を検索できませんでした: {searchError}
        </p>
      ) : isSearching ? (
        <p className="p-3 text-xs text-gray-400">検索中...</p>
      ) : result !== undefined ? (
        <SearchResults result={result} onPick={onPick} />
      ) : null}
    </section>
  );
}

function SearchResults({
  result,
  onPick,
}: {
  result: BookSearchResult;
  onPick: (match: BookSearchMatch) => void;
}) {
  if (result.matches.length === 0) {
    return <p className="p-3 text-xs text-gray-500">見つかりませんでした</p>;
  }

  return (
    <>
      {/* A cut-off list says so: the reader would otherwise take the last page
          in it for the last place the words are. */}
      <p role="status" className="shrink-0 px-3 pt-2 text-xs text-gray-500">
        {result.truncated
          ? `${result.matches.length}件以上（先頭の${result.matches.length}件を表示）`
          : `${result.matches.length}件`}
      </p>
      <ul className="flex-1 overflow-y-auto py-1">
        {result.matches.map((match, i) => (
          // Two matches can share every field (the same words twice on a page
          // with the same text around them), so the position is the key. The
          // list is replaced whole on every search, never reordered.
          <li key={i}>
            <button
              type="button"
              onClick={() => onPick(match)}
              className="flex w-full cursor-pointer gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50"
            >
              <span className="w-10 shrink-0 text-gray-400 tabular-nums">p.{match.pageNumber}</span>
              <span className="min-w-0 flex-1 break-words text-gray-700">
                {match.before && <>…{match.before}</>}
                <mark className="rounded-sm bg-amber-200 text-gray-900">{match.match}</mark>
                {match.after && <>{match.after}…</>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The search through the book's text, where the viewer puts it: beside the page
 * like the outline on a wide screen, over the page as a drawer on one column.
 *
 * Shared by both viewers, so a PDF and an EPUB are searched and marked the same
 * way. Picking a result is following a citation: the page turns to it and the
 * words are marked through `citedPassageAtom`, with the text around them saying
 * which of the times they are on the page the reader picked. The URL follows
 * the page through `useReadingLocation`, which is the only thing that writes it.
 */
export function BookSearch({
  pdfId,
  search,
}: {
  pdfId: string | undefined;
  /** Injectable so the panel can be tested without a server. */
  search?: SearchBookText;
}) {
  const [open, setOpen] = useAtom(bookSearchOpenAtom);
  const setCurrentPage = useSetAtom(currentPageAtom);
  const setCitedPassage = useSetAtom(citedPassageAtom);
  const isNarrow = useIsNarrow();
  const { query, setQuery, submit, result, isSearching, searchError } = useBookTextSearch(
    pdfId,
    search,
  );

  const pick = useCallback(
    (match: BookSearchMatch) => {
      setCitedPassage({
        pageNumber: match.pageNumber,
        text: match.match,
        context: { before: match.before, after: match.after },
      });
      setCurrentPage(match.pageNumber);
      // Over the page, the drawer is in the way of what was just found; beside
      // it, it stays for the next result.
      if (isNarrow) setOpen(false);
    },
    [isNarrow, setCitedPassage, setCurrentPage, setOpen],
  );

  if (!open) return null;

  const panel = (
    <BookSearchPanel
      query={query}
      onQueryChange={setQuery}
      onSearch={submit}
      result={result}
      isSearching={isSearching}
      searchError={searchError}
      onPick={pick}
    />
  );

  if (!isNarrow) return panel;

  return (
    <>
      <button
        type="button"
        aria-label="検索を閉じる"
        onClick={() => setOpen(false)}
        className="absolute inset-0 z-20 bg-black/40"
      />
      <div className="absolute inset-y-0 left-0 z-30 flex shadow-xl">{panel}</div>
    </>
  );
}
