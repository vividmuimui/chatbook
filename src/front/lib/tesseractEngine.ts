import type { OcrEngine } from "./pdfOcr";
import type { RecognizedLine } from "./ocrText";

/**
 * Where the worker, the WebAssembly core and the language models are served
 * from — copied out of node_modules by `scripts/copy-tesseract-assets.mjs`.
 *
 * Absolute URLs: the worker is started from a blob, which has no base of its
 * own to resolve a path against.
 */
const assetUrl = (path: string) => new URL(`/tesseract/${path}`, window.location.origin).href;

/**
 * Japanese first: it is what this app's books are mostly in, and Tesseract
 * leans on the first language where the two disagree. English is there for
 * the words a technical book sets in Latin letters.
 */
const LANGUAGES = ["jpn", "eng"];

/**
 * Starts Tesseract in a Web Worker, ready to read pages.
 *
 * Imported only here and only when a book needs it, so a reader who never adds
 * a scanned book never downloads it. The models are kept in IndexedDB by
 * Tesseract itself after the first run.
 */
export async function createTesseractEngine(): Promise<OcrEngine> {
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker(LANGUAGES, OEM.LSTM_ONLY, {
    workerPath: assetUrl("worker.min.js"),
    corePath: assetUrl("core"),
    langPath: assetUrl("lang"),
  });

  return {
    async recognize(image) {
      // Only the blocks: the lines and their boxes are all that is kept, and
      // asking for the hOCR and TSV forms as well would build them for nothing.
      const { data } = await worker.recognize(image, {}, { text: false, blocks: true });
      return (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line): RecognizedLine => ({ text: line.text, bbox: line.bbox })),
        ),
      );
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
