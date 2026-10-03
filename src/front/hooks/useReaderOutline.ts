import { useCallback, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ResultAsync } from "neverthrow";
import { useSWRConfig } from "swr";
import { usePdfOutline } from "./usePdfOutline";
import { bookKey, useBook } from "./useBook";
import { chaptersKey, fetchChapters, useChapters, type LoadChapters } from "./useChapters";
import { chaptersAsOutline, type OutlineEntry } from "../lib/pdfOutline";
import { resultFetcher, type ApiError } from "../lib/fetcher";
import { generatedOutlineSchema, type GeneratedOutline } from "../../shared/schemas/book";
import type { BookDetail } from "../../shared/schemas/book";

/** Asks the server to have the model make the book a table of contents. */
export type GenerateOutline = (pdfId: string) => ResultAsync<GeneratedOutline, ApiError>;

const requestOutlineGeneration: GenerateOutline = (pdfId) =>
  resultFetcher(`/api/pdf/${pdfId}/outline/generate`, generatedOutlineSchema, {
    method: "POST",
  });

/** Having the model make a table of contents, as the outline panel offers it. */
export interface OutlineGeneration {
  onGenerate: () => Promise<void> | void;
  generating: boolean;
  /** Why the last attempt made none, if it did not. */
  error: string | null;
}

const NO_ENTRIES: OutlineEntry[] = [];

/**
 * The table of contents the reader's outline panel shows, and a way to have one
 * made for a book that has none.
 *
 * The PDF's own bookmarks where it has them. A PDF without any shows the
 * chapters stored for it instead — which, for a book whose bytes carry no
 * outline, can only be ones the model made (`/outline/generate`): the server's
 * chapter list (`useChapters`) is read rather than the stored outline itself,
 * so the panel, the chat's scope menu and the excerpts all come from one place.
 * The chapters are only asked for when the book says it has an outline, so a
 * book with none says so at once rather than after a round trip.
 *
 * A table of contents made here is written into the two cache entries that
 * follow from it — the chapter list (re-read, since the server works out the
 * spans) and the book's `hasOutline`, which is what has the chapters asked for
 * at all and stops the reader's backfill from trying to extract one.
 */
export function useReaderOutline(
  pdfId: string | undefined,
  doc: PDFDocumentProxy | null,
  generate: GenerateOutline = requestOutlineGeneration,
  loadChapters: LoadChapters = fetchChapters,
) {
  const { outline: own, error: ownError } = usePdfOutline(doc);
  const { data: book } = useBook(pdfId);
  const { mutate } = useSWRConfig();

  const hasNoBookmarks = own !== null && own.length === 0;
  const stored = useChapters(hasNoBookmarks && book?.hasOutline ? pdfId : undefined, loadChapters);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const onGenerate = useCallback(async () => {
    if (!pdfId) return;

    setGenerating(true);
    setGenerateError(null);
    const made = await generate(pdfId);
    setGenerating(false);

    if (made.isErr()) {
      setGenerateError(made.error.message);
      return;
    }
    await Promise.all([
      mutate(chaptersKey(pdfId)),
      mutate(
        bookKey(pdfId),
        (current: BookDetail | undefined) => (current ? { ...current, hasOutline: true } : current),
        { revalidate: false },
      ),
    ]);
  }, [pdfId, generate, mutate]);

  const generation: OutlineGeneration = { onGenerate, generating, error: generateError };

  if (!hasNoBookmarks) return { outline: own, error: ownError, generation };
  // Not known yet whether there is anything stored to show, which is not the
  // same as there being nothing: the panel says it is still loading.
  if (!book) return { outline: null, error: null, generation };
  if (!book.hasOutline) return { outline: NO_ENTRIES, error: null, generation };
  if (stored.error) {
    return {
      outline: null,
      error: stored.error instanceof Error ? stored.error.message : String(stored.error),
      generation,
    };
  }
  return {
    outline: stored.data ? chaptersAsOutline(stored.data.chapters) : null,
    error: null,
    generation,
  };
}
