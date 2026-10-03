import useSWRImmutable from "swr/immutable";
import { fetcher } from "../lib/fetcher";
import { ocrTextSchema, type OcrText } from "../../shared/schemas/ocr";

const OCR_PREFIX = "/api/pdf/";
const OCR_SUFFIX = "/ocr";

/** Cache key of a scanned book's OCR lines, and the endpoint they are read from. */
export const ocrKey = (pdfId: string) => `${OCR_PREFIX}${pdfId}${OCR_SUFFIX}`;

/** The inverse of `ocrKey`, so what is fetched cannot drift from what it is filed under. */
const pdfIdFromKey = (key: string) => key.slice(OCR_PREFIX.length, -OCR_SUFFIX.length);

export type LoadOcrText = (pdfId: string) => Promise<OcrText>;

const fetchOcrText: LoadOcrText = (pdfId) => fetcher(ocrKey(pdfId), ocrTextSchema);

/**
 * The lines OCR read off a scanned book, for the viewer to lay over its pages.
 *
 * Asked for only when the book says it has them, so a typeset book costs no
 * request. Immutable: the lines are stored under the book's own hash and only
 * an upload of the same bytes writes them, so there is nothing to revalidate —
 * and the server lets the browser keep them besides. A book just uploaded
 * finds them already in the cache, filed there by `useOpenPdfBook`.
 */
export function useOcrText(
  pdfId: string | undefined,
  hasOcr: boolean | undefined,
  load: LoadOcrText = fetchOcrText,
) {
  return useSWRImmutable(pdfId && hasOcr ? ocrKey(pdfId) : null, (key: string) =>
    load(pdfIdFromKey(key)),
  );
}
