import { useSWRConfig } from "swr";
import { ResultAsync } from "neverthrow";
import type { ExtractedPdfData } from "../lib/pdfLoader";
import { extractBookData } from "../lib/bookLoader";
import { postWithProgress } from "../lib/fetcher";
import { bookKey } from "./useBook";
import { rememberUploadedFile } from "../lib/uploadedFileHandoff";
import { pdfMetadataSchema, type BookDetail } from "../../shared/schemas/book";

/** Whatever was thrown, as something with a `message` the reader can be shown. */
const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/** What opening a book can be handed besides the file. */
export interface OpenBookOptions {
  /**
   * The Dropbox file `file` was just downloaded from. The server then fetches
   * the bytes from Dropbox itself rather than having the reader send back what
   * it has only just received.
   */
  dropboxId?: string;
  /**
   * How far the upload has got, for this call alone — the import of a whole
   * Dropbox folder reports each file on its own card rather than on the shelf's
   * covering notice, which the hook's own `onProgress` drives.
   */
  onProgress?: (ratio: number) => void;
  /**
   * Whether the file is left for the viewer to take over (`rememberUploadedFile`)
   * — true by default, for the reader who is about to open the book. The import
   * of a whole folder passes false: nobody is about to open those books, and the
   * one slot would otherwise hold each book's bytes until the next replaced it.
   */
  handOff?: boolean;
}

/** A book the reader's file became. */
export interface StoredBook {
  id: string;
  /**
   * A book of pictures whose text OCR is still to read. It is stored without
   * that text; whoever opened it starts the reading (`useBackgroundOcr`).
   * False for a book of pictures added again after it was read — the server
   * kept what was read.
   */
  ocrPending: boolean;
}

/** Turns a file the reader chose into a stored book. */
export type OpenPdfBook = (file: File, options?: OpenBookOptions) => ResultAsync<StoredBook, Error>;

/**
 * Reads a chosen PDF, stores it, and seeds the cache the reader opens it from.
 *
 * A hook rather than a plain function because the last step writes to the SWR
 * cache. The reason a file did not become a book comes back in the value:
 * whoever called this is an event handler, the end of the line for a rejected
 * promise — not even the route's errorElement would catch one — and the reader
 * would be left with a picker that appeared to do nothing.
 *
 * A book of pictures is stored as it is, with whatever text pdf.js could read
 * (usually none): OCR takes minutes, and runs afterwards in the background.
 */
export function useOpenPdfBook(
  extract: (file: File) => Promise<ExtractedPdfData> = extractBookData,
  onProgress: (ratio: number) => void = () => {},
  createRequest?: () => XMLHttpRequest,
): OpenPdfBook {
  const { mutate } = useSWRConfig();

  return (
    file: File,
    { dropboxId, onProgress: reportUpload = onProgress, handOff = true }: OpenBookOptions = {},
  ) =>
    // Reading the file is pdf.js' job and can fail on its own (a file that is
    // not really a PDF), so it is part of the same result as the upload.
    ResultAsync.fromPromise(extract(file), asError)
      .andThen((extracted) => {
        // Send as multipart/form-data (avoids base64 overhead)
        const formData = new FormData();
        if (dropboxId) formData.append("dropboxId", dropboxId);
        else formData.append("file", file);
        formData.append("fullText", extracted.fullText);
        formData.append("pageCount", String(extracted.pageCount));
        // What lets the server keep a book with no text: its text is to come.
        if (extracted.needsOcr) formData.append("ocrPending", "true");
        if (extracted.thumbnail) {
          formData.append("thumbnail", extracted.thumbnail, "cover.webp");
        }
        // Absent rather than empty when there is none: the server refuses an
        // empty outline, and NULL is what sends chat to its page window.
        if (extracted.outline) {
          formData.append("outline", JSON.stringify(extracted.outline));
        }

        // Sent with progress rather than through `resultFetcher`: a book is
        // large enough that the reader has to see it moving (22MB over a
        // phone's connection is around a minute).
        return postWithProgress(
          "/api/pdf/open",
          pdfMetadataSchema,
          formData,
          reportUpload,
          createRequest,
        ).map((result) => ({
          result,
          hasThumbnail: extracted.thumbnail !== null,
          hasOutline: extracted.outline !== null,
        }));
      })
      .andThen(({ result, hasThumbnail, hasOutline }) => {
        // The upload already answered with everything the reader needs to open
        // the book, so hand it to the cache the reader reads from. Without this
        // the reader would show an empty viewer while it asked for the very
        // thing that was just sent.
        //
        // The highlight list starts empty because the upload does not report
        // one. Opening a book that was annotated before therefore shows its
        // highlights a moment late, when the reader's own read of the book
        // lands on top of this entry.
        const ocrPending = result.ocrPending ?? false;
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
          // Lines come with the OCR that is still to run, if there is any to
          // run. A book of pictures added again after it was read has its
          // lines already, which the reader's own read of the book — on
          // mount, over this seed — says.
          hasOcr: false,
          ocrPending,
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
        if (handOff) rememberUploadedFile(result.id, file);

        return ResultAsync.fromPromise(
          mutate(bookKey(result.id), book, { revalidate: false }),
          asError,
        ).map(() => ({ id: result.id, ocrPending }));
      });
}
