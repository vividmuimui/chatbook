import { useSWRConfig } from "swr";
import { ResultAsync } from "neverthrow";
import type { ExtractOptions, ExtractedPdfData } from "../lib/pdfLoader";
import { extractBookData } from "../lib/bookLoader";
import { postWithProgress } from "../lib/fetcher";
import { bookKey } from "./useBook";
import { ocrKey } from "./useOcrText";
import { rememberUploadedFile } from "../lib/uploadedFileHandoff";
import { pdfMetadataSchema, type BookDetail } from "../../shared/schemas/book";

/**
 * Whatever was thrown, as something with a `message` the reader can be shown.
 *
 * A `DOMException` keeps its name: an `AbortError` is how a cancelled OCR run
 * ends, and the shelf tells it from a failure by that name alone. (Not every
 * runtime makes a DOMException an Error.)
 */
const asError = (cause: unknown) => {
  if (cause instanceof Error) return cause;
  if (cause instanceof DOMException) {
    return Object.assign(new Error(cause.message), { name: cause.name });
  }
  return new Error(String(cause));
};

/** What opening a book can be handed besides the file. */
export interface OpenBookOptions extends Pick<ExtractOptions, "signal" | "onOcrProgress"> {
  /**
   * The Dropbox file `file` was just downloaded from. The server then fetches
   * the bytes from Dropbox itself rather than having the reader send back what
   * it has only just received.
   */
  dropboxId?: string;
}

/**
 * Turns a file the reader chose into a stored book, and hands back its id.
 *
 * `signal` and `onOcrProgress` reach the extraction: a scanned book is read by
 * OCR there, which takes long enough that the reader has to see it moving and
 * be able to stop it. Cancelling fails the result with an `AbortError` before
 * anything is sent, so nothing is stored.
 */
export type OpenPdfBook = (file: File, options?: OpenBookOptions) => ResultAsync<string, Error>;

/**
 * Reads a chosen PDF, stores it, and seeds the cache the reader opens it from.
 *
 * A hook rather than a plain function because the last step writes to the SWR
 * cache. The reason a file did not become a book comes back in the value:
 * whoever called this is an event handler, the end of the line for a rejected
 * promise — not even the route's errorElement would catch one — and the reader
 * would be left with a picker that appeared to do nothing.
 */
export function useOpenPdfBook(
  extract: (file: File, options: ExtractOptions) => Promise<ExtractedPdfData> = extractBookData,
  onProgress: (ratio: number) => void = () => {},
  createRequest?: () => XMLHttpRequest,
): OpenPdfBook {
  const { mutate } = useSWRConfig();

  return (file: File, { dropboxId, signal, onOcrProgress }: OpenBookOptions = {}) =>
    // Reading the file is pdf.js' job and can fail on its own (a file that is
    // not really a PDF), so it is part of the same result as the upload.
    ResultAsync.fromPromise(extract(file, { signal, onOcrProgress }), asError)
      .andThen((extracted) => {
        // Send as multipart/form-data (avoids base64 overhead)
        const formData = new FormData();
        if (dropboxId) formData.append("dropboxId", dropboxId);
        else formData.append("file", file);
        formData.append("fullText", extracted.fullText);
        formData.append("pageCount", String(extracted.pageCount));
        if (extracted.thumbnail) {
          formData.append("thumbnail", extracted.thumbnail, "cover.webp");
        }
        // Absent rather than empty when there is none: the server refuses an
        // empty outline, and NULL is what sends chat to its page window.
        if (extracted.outline) {
          formData.append("outline", JSON.stringify(extracted.outline));
        }
        // A file rather than a field: a box per line on every page of a long
        // book runs to a megabyte or so.
        if (extracted.ocr) {
          formData.append(
            "ocr",
            new Blob([JSON.stringify(extracted.ocr)], { type: "application/json" }),
            "ocr.json",
          );
        }

        // Sent with progress rather than through `resultFetcher`: a book is
        // large enough that the reader has to see it moving (22MB over a
        // phone's connection is around a minute).
        return postWithProgress(
          "/api/pdf/open",
          pdfMetadataSchema,
          formData,
          onProgress,
          createRequest,
        ).map((result) => ({
          result,
          hasThumbnail: extracted.thumbnail !== null,
          hasOutline: extracted.outline !== null,
          ocr: extracted.ocr,
        }));
      })
      .andThen(({ result, hasThumbnail, hasOutline, ocr }) => {
        // The upload already answered with everything the reader needs to open
        // the book, so hand it to the cache the reader reads from. Without this
        // the reader would show an empty viewer while it asked for the very
        // thing that was just sent.
        //
        // The highlight list starts empty because the upload does not report
        // one. Opening a book that was annotated before therefore shows its
        // highlights a moment late, when the reader's own read of the book
        // lands on top of this entry.
        const book: BookDetail = {
          id: result.id,
          fileName: result.fileName,
          // Read off the bytes by the server, so the reader picks the viewer
          // the stored book needs rather than the one the file name implies.
          format: result.format,
          pageCount: result.pageCount,
          hasThumbnail,
          // The upload this answers for stored the outline in the same
          // request, so the seed can say so without asking the server — and
          // must, or the reader's backfill would re-send it on arrival.
          hasOutline,
          // Exact, like the outline: this upload is what stored the lines.
          hasOcr: ocr !== null,
          selections: [],
          // The place travels with the upload's answer, so a book that was read
          // on another device opens where it was left rather than at page 1.
          readingState: result.readingState,
          // A book renamed before keeps its name through being added again.
          title: result.title,
          pageDirection: result.pageDirection,
        };
        // The same reasoning as the cache seed, for the bytes rather than the
        // book: the viewer this navigates to would otherwise ask the API for
        // the very file that has just gone up, which over a phone's connection
        // costs the upload all over again.
        rememberUploadedFile(result.id, file);

        return ResultAsync.fromPromise(
          Promise.all([
            mutate(bookKey(result.id), book, { revalidate: false }),
            // The lines too, for the same reason as the book: the viewer would
            // otherwise fetch back what was read here moments ago.
            ocr ? mutate(ocrKey(result.id), ocr, { revalidate: false }) : undefined,
          ]),
          asError,
        ).map(() => result.id);
      });
}
