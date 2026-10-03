import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OcrPage } from "../../shared/schemas/ocr";
import { toOcrLines, type RecognizedLine } from "./ocrText";

/**
 * Something that reads the lines of text in a drawn page.
 *
 * Tesseract in the app (`tesseractEngine.ts`); a stand-in in the tests, which
 * have neither a canvas to draw on nor the minutes a real run takes.
 */
export interface OcrEngine {
  recognize(image: HTMLCanvasElement): Promise<RecognizedLine[]>;
  terminate(): Promise<void>;
}

export type CreateOcrEngine = () => Promise<OcrEngine>;

/** How far OCR has got, in pages. */
export interface OcrProgress {
  done: number;
  total: number;
}

/**
 * The scale a page is drawn at for OCR. 2 puts 10pt type at about 28px tall,
 * where Tesseract's Japanese model reads well; drawing larger buys little and
 * costs the time of every page.
 */
export const OCR_RENDER_SCALE = 2;

/** The longest side a page is drawn at for OCR, whatever its size in points. */
export const MAX_OCR_RENDER_SIDE = 3000;

/**
 * The scale to draw a page of the given size at. A poster-sized page drawn at
 * 2× would hold a canvas of hundreds of megabytes on a phone.
 */
export function ocrRenderScale(width: number, height: number): number {
  return Math.min(OCR_RENDER_SCALE, MAX_OCR_RENDER_SIDE / Math.max(width, height));
}

/** How a cancelled run ends: named like the platform's own aborts. */
const aborted = () => Object.assign(new Error("OCR was cancelled"), { name: "AbortError" });

/**
 * A promise that gives up as soon as the signal fires. A page can take many
 * seconds to read, and a reader who pressed cancel should not wait it out.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Reads the named pages of a document by OCR, one at a time.
 *
 * One page at a time and nothing kept between them: each page is drawn on a
 * canvas of its own, read, and the canvas emptied before the next — a book of
 * scans held as canvases would be gigabytes. The engine is started only once
 * there is a page to read, and let go of however this ends, cancelled included.
 *
 * Throws an `AbortError` when the signal fires; whatever was read until then is
 * dropped, since a book that is only partly read is not the book.
 */
export async function readPagesByOcr(
  doc: PDFDocumentProxy,
  pageNumbers: number[],
  createEngine: CreateOcrEngine,
  {
    onProgress,
    signal,
  }: { onProgress?: (progress: OcrProgress) => void; signal?: AbortSignal } = {},
): Promise<OcrPage[]> {
  if (signal?.aborted) throw aborted();
  const total = pageNumbers.length;
  onProgress?.({ done: 0, total });

  const starting = createEngine();
  let engine: OcrEngine;
  try {
    engine = await untilAborted(starting, signal);
  } catch (cause) {
    // Cancelled while the engine was still loading: it is let go of once it
    // has, rather than left running with nobody to stop it. An engine that
    // failed to load or to stop has nothing left to tell a reader who has
    // already cancelled.
    void starting.then((late) => late.terminate()).catch(() => {});
    throw cause;
  }
  try {
    const pages: OcrPage[] = [];
    for (const pageNumber of pageNumbers) {
      if (signal?.aborted) throw aborted();
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = ocrRenderScale(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await untilAborted(page.render({ canvas, viewport }).promise, signal);
        const lines = await untilAborted(engine.recognize(canvas), signal);
        pages.push({ pageNumber, lines: toOcrLines(lines, scale) });
      } finally {
        // Emptying the canvas is what frees its pixels; dropping the reference
        // leaves them to a garbage collector that is in no hurry.
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      onProgress?.({ done: pages.length, total });
    }
    return pages;
  } finally {
    // Stopping the worker is also what stops a page still being read
    void engine.terminate().catch(() => {
      // Nothing to report: the worker is being thrown away either way, and
      // the reader's book (or their cancellation) does not depend on it.
    });
  }
}
