import { useCallback, useState } from "react";
import type { ResultAsync } from "neverthrow";
import { useBook } from "./useBook";
import { resultFetcher, type ApiError } from "../lib/fetcher";
import { pageDirectionSavedSchema, type PageDirection } from "../../shared/schemas/book";

/** Turns a book's pages the other way. A write, so its failure comes back in the value. */
export type SavePageDirection = (
  pdfId: string,
  direction: PageDirection,
) => ResultAsync<PageDirection, ApiError>;

const requestPageDirection: SavePageDirection = (pdfId, direction) =>
  resultFetcher(`/api/pdf/${pdfId}/page-direction`, pageDirectionSavedSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageDirection: direction }),
  }).map((saved) => saved.pageDirection);

/**
 * Which way the open book's pages turn, and a way to turn them the other way.
 *
 * The direction is the book's own (`GET /api/pdf/:pdfId`), so a change is
 * written into the book's cache entry once the server has taken it: the
 * viewer, the toolbar and this menu all read the book, and they follow it in
 * the same render. Not optimistically — a refusal would have to turn the pages
 * back under the reader. What comes back on failure is the reason alone; the
 * menu that offered the choice words it.
 */
export function usePageDirection(
  pdfId: string | undefined,
  save: SavePageDirection = requestPageDirection,
) {
  const { data, mutate } = useBook(pdfId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changeDirection = useCallback(
    async (direction: PageDirection) => {
      if (!pdfId) return;

      setSaving(true);
      setError(null);
      const saved = await save(pdfId, direction);
      setSaving(false);

      saved.match(
        (stored) => {
          void mutate((book) => (book ? { ...book, pageDirection: stored } : book), {
            revalidate: false,
          });
        },
        (failure) => setError(failure.message),
      );
    },
    [pdfId, save, mutate],
  );

  return { direction: data?.pageDirection ?? null, changeDirection, saving, error };
}
