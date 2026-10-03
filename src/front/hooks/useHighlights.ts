import { useCallback, useMemo } from "react";
import type { ResultAsync } from "neverthrow";
import { useBook, fetchBook, type LoadBook } from "./useBook";
import { resultFetcher, type ApiError } from "../lib/fetcher";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  selectionDeletedSchema,
  selectionUpdatedSchema,
  type CreatedSelection,
  type SelectionHighlight,
  type SelectionUpdated,
  type UpdateSelectionRequest,
} from "../../shared/schemas/selection";

const NO_HIGHLIGHTS: SelectionHighlight[] = [];

/** Removes a highlight. A write, so its failure comes back in the value. */
export type DeleteHighlight = (
  pdfId: string,
  selectionId: string,
) => ResultAsync<unknown, ApiError>;

const requestHighlightDeletion: DeleteHighlight = (pdfId, selectionId) =>
  resultFetcher(`/api/pdf/${pdfId}/selections/${selectionId}`, selectionDeletedSchema, {
    method: "DELETE",
  });

/** Recolours a highlight or rewrites its note. A write, so its failure comes back in the value. */
export type UpdateHighlight = (
  pdfId: string,
  selectionId: string,
  change: UpdateSelectionRequest,
) => ResultAsync<SelectionUpdated, ApiError>;

const requestHighlightUpdate: UpdateHighlight = (pdfId, selectionId, change) =>
  resultFetcher(`/api/pdf/${pdfId}/selections/${selectionId}`, selectionUpdatedSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });

/**
 * The colour a highlight is drawn in: the one stored with it.
 *
 * The column is NOT NULL with yellow as its default, so every row the server
 * hands over has one — rows from before colours could be chosen are all
 * yellow, and that is what they mean. A blank one would only come from a
 * cache written by hand; it is drawn in that same default rather than given a
 * colour by its place in the list, which would change under it whenever a
 * highlight before it was deleted.
 */
function drawnColor(selection: SelectionHighlight): string {
  return selection.color || DEFAULT_HIGHLIGHT_COLOR;
}

/** The highlights of the book currently open, and ways to add, change and remove one. */
export function useHighlights(
  pdfId: string | undefined,
  loadBook: LoadBook = fetchBook,
  deleteHighlight: DeleteHighlight = requestHighlightDeletion,
  updateSelection: UpdateHighlight = requestHighlightUpdate,
) {
  const { data, mutate } = useBook(pdfId, loadBook);

  const highlights = useMemo(
    () =>
      data?.selections.map((selection) =>
        selection.color ? selection : { ...selection, color: drawnColor(selection) },
      ) ?? NO_HIGHLIGHTS,
    [data],
  );

  /**
   * Show a highlight the moment it is made. The server has just stored it and
   * answered with the stored row, colour and note included, so re-reading the
   * book would only confirm what was sent.
   */
  const addHighlight = useCallback(
    (selection: CreatedSelection) => {
      void mutate(
        (book) => (book ? { ...book, selections: [...book.selections, selection] } : book),
        { revalidate: false },
      );
    },
    [mutate],
  );

  /**
   * Recolour a highlight or rewrite its note, once the server has taken the
   * change — the same rule as deleting: what is drawn is what is stored, so a
   * refusal has nothing to put back. Written into the book's own entry, so the
   * page, the list and the open conversation all follow it at once.
   *
   * The book is named by the caller for the reason `removeHighlight` gives,
   * and has to be the one this hook was given for the same reason.
   */
  const updateHighlight = useCallback(
    (
      bookId: string,
      selectionId: string,
      change: UpdateSelectionRequest,
    ): ResultAsync<void, ApiError> =>
      updateSelection(bookId, selectionId, change).map((updated) => {
        void mutate(
          (book) =>
            book
              ? {
                  ...book,
                  selections: book.selections.map((s) =>
                    s.id === updated.id ? { ...s, color: updated.color, note: updated.note } : s,
                  ),
                }
              : book,
          { revalidate: false },
        );
      }),
    [updateSelection, mutate],
  );

  /**
   * Drop a highlight the reader asked to be rid of, along with its chat.
   *
   * Only once the server has taken it: a list that lost it optimistically would
   * have to put it back on a refusal, and the reader would watch it return.
   *
   * The book is named by the caller rather than taken from the one being read,
   * because there is no highlight to delete until a book is in hand — asking
   * for it here is what keeps this from having to answer for a book that is
   * not open yet. **It has to be the book this hook was given**: the request
   * follows `bookId` but the list that loses the highlight is the one under
   * `pdfId`, and naming two different books would take it off the wrong one.
   */
  const removeHighlight = useCallback(
    (bookId: string, selectionId: string): ResultAsync<void, ApiError> =>
      deleteHighlight(bookId, selectionId).map(() => {
        void mutate(
          (book) =>
            book
              ? { ...book, selections: book.selections.filter((s) => s.id !== selectionId) }
              : book,
          { revalidate: false },
        );
      }),
    [deleteHighlight, mutate],
  );

  return { highlights, addHighlight, updateHighlight, removeHighlight };
}
