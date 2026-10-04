import type { SaveOcrRequest } from "../../shared/schemas/ocr";
import { ocrPageText, pagesNeedingOcr } from "./ocrText";
import { pdfjsLib, PDFJS_ASSET_OPTIONS } from "./pdfjsConfig";
import { readPageTexts } from "./pdfLoader";
import { readPagesByOcr, type CreateOcrEngine, type OcrProgress } from "./pdfOcr";
import { createTesseractEngine } from "./tesseractEngine";

export interface ReadBookByOcrOptions {
  onProgress?: (progress: OcrProgress) => void;
  /** Stops the reading; it then fails with an `AbortError`. */
  signal?: AbortSignal;
  /** Injectable so a test can stand in for Tesseract. */
  createOcrEngine?: CreateOcrEngine;
}

/**
 * Reads a stored book of pictures by OCR: what the server is sent once it is
 * done (`PUT /api/pdf/:pdfId/ocr`).
 *
 * The pages to read are worked out the way they were when the book was added
 * (`pagesNeedingOcr`), so a reading started again after a reload reads the
 * same ones. The pages pdf.js can read keep their own text, and what OCR read
 * takes the others' place in the whole text, so the server — which never tells
 * the two kinds of book apart — gets a book it can search and quote like any
 * other. The document is let go of however this ends.
 */
export async function readBookByOcr(
  bytes: Uint8Array,
  { onProgress, signal, createOcrEngine = createTesseractEngine }: ReadBookByOcrOptions = {},
): Promise<SaveOcrRequest> {
  const doc = await pdfjsLib.getDocument({ data: bytes, ...PDFJS_ASSET_OPTIONS }).promise;
  try {
    const pageTexts = await readPageTexts(doc);
    const unreadable = pagesNeedingOcr(pageTexts);
    const pages =
      unreadable.length > 0
        ? await readPagesByOcr(doc, unreadable, createOcrEngine, { onProgress, signal })
        : [];
    for (const page of pages) pageTexts[page.pageNumber - 1] = ocrPageText(page.lines);
    // Pages are joined with a form feed so the server can map a quoted passage
    // back to the page it came from (see chatService.findPageNumber)
    return { fullText: pageTexts.join("\f"), pages };
  } finally {
    // The book is held for minutes and then not at all: its pages and worker
    // go now rather than whenever the collector gets to them.
    await doc.loadingTask.destroy();
  }
}

/** Whether a reading found any text at all. */
export function foundNoText({ fullText }: SaveOcrRequest): boolean {
  return fullText.replaceAll("\f", "").trim() === "";
}
