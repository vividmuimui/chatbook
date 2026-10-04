import { useCallback, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import type { ResultAsync } from "neverthrow";
import { foundNoText, readBookByOcr } from "../lib/bookOcr";
import { readRefusal, resultFetcher, type ApiError } from "../lib/fetcher";
import { ocrQueue as tabQueue, type OcrJob, type OcrQueue } from "../lib/ocrQueue";
import type { OcrProgress } from "../lib/pdfOcr";
import { SHELF_KEY } from "../lib/shelfKey";
import { bookKey } from "./useBook";
import { ocrKey } from "./useOcrText";
import type { BookDetail, BookSummary } from "../../shared/schemas/book";
import {
  ocrSavedSchema,
  type OcrSaved,
  type OcrText,
  type SaveOcrRequest,
} from "../../shared/schemas/ocr";

/**
 * Reads a stored book by OCR. Handed the file when the reader has just added
 * it — no need to download what is already here — and null when the reading
 * is started again after a reload, when it is fetched from the server.
 */
export type ReadStoredBookByOcr = (
  pdfId: string,
  file: File | null,
  options: { signal: AbortSignal; onProgress: (progress: OcrProgress) => void },
) => Promise<SaveOcrRequest>;

export type SaveOcr = (pdfId: string, read: SaveOcrRequest) => ResultAsync<OcrSaved, ApiError>;

const readStoredBook: ReadStoredBookByOcr = async (pdfId, file, options) => {
  let bytes: ArrayBuffer;
  if (file) {
    bytes = await file.arrayBuffer();
  } else {
    const url = `/api/pdf/${pdfId}/file`;
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) throw await readRefusal(url, response);
    bytes = await response.arrayBuffer();
  }
  return readBookByOcr(new Uint8Array(bytes), options);
};

const requestOcrSave: SaveOcr = (pdfId, read) =>
  resultFetcher(`/api/pdf/${pdfId}/ocr`, ocrSavedSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(read),
  });

export interface BackgroundOcr {
  /** Every book being read, waiting, or stopped by a failure, by id. */
  jobs: ReadonlyMap<string, OcrJob>;
  /** Reads a stored book by OCR in the background, after any book already in the queue. */
  start: (pdfId: string, file?: File | null) => void;
  /** Stops a book's reading; the server still has it waiting. */
  cancel: (pdfId: string) => void;
}

/**
 * The tab's OCR queue, as a page sees it and adds to it.
 *
 * What a finished reading leaves behind is written into the caches it is read
 * from — the book (no longer waiting, with lines to lay over its pages), its
 * lines, and the shelf — through the `mutate` of the page that started it. That
 * `mutate` is the cache's, not the page's, so it still works once the reader has
 * moved on: the reading finishes wherever they are, and a viewer open on the
 * book draws its text layer as soon as it lands.
 */
export function useBackgroundOcr({
  read = readStoredBook,
  save = requestOcrSave,
  queue = tabQueue,
}: { read?: ReadStoredBookByOcr; save?: SaveOcr; queue?: OcrQueue } = {}): BackgroundOcr {
  const { mutate } = useSWRConfig();
  const jobs = useSyncExternalStore(queue.subscribe, queue.getSnapshot);

  const start = useCallback(
    (pdfId: string, file: File | null = null) =>
      queue.enqueue(pdfId, async ({ signal, progress, saving }) => {
        const result = await read(pdfId, file, {
          signal,
          onProgress: ({ done, total }) => progress(done, total),
        });
        saving();
        const saved = await save(pdfId, result);
        if (saved.isErr()) throw saved.error;

        const { hasOcr } = saved.value;
        await Promise.all([
          mutate<BookDetail>(
            bookKey(pdfId),
            (current) => (current ? { ...current, hasOcr, ocrPending: false } : current),
            { revalidate: false },
          ),
          // The lines go in before anyone asks: the viewer would otherwise
          // fetch back what was read here moments ago.
          hasOcr
            ? mutate<OcrText>(ocrKey(pdfId), { pages: result.pages }, { revalidate: false })
            : undefined,
          mutate<BookSummary[]>(
            SHELF_KEY,
            (current) => current?.map((b) => (b.id === pdfId ? { ...b, ocrPending: false } : b)),
            { revalidate: false },
          ),
        ]);
        return foundNoText(result) ? "unreadable" : "read";
      }),
    [queue, read, save, mutate],
  );

  return { jobs, start, cancel: queue.cancel };
}
