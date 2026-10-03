import { extractEpubData } from "./epubLoader";
import { extractPdfData, type ExtractOptions, type ExtractedPdfData } from "./pdfLoader";

/**
 * Whether a file is an EPUB, read off its first bytes the way the server reads
 * it (`bookFormatOf`): an EPUB is a ZIP archive, and a PDF never starts like one.
 */
export async function isEpubFile(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** Read a book the reader chose, whichever of the two formats it is in. */
export async function extractBookData(
  file: File,
  options: ExtractOptions = {},
): Promise<ExtractedPdfData> {
  // Only a PDF can be without text: an EPUB's chapters are markup
  return (await isEpubFile(file)) ? extractEpubData(file) : extractPdfData(file, options);
}
