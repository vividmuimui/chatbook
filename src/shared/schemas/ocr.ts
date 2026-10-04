import { z } from "zod";

/**
 * One line of text read off a page that carried no text of its own.
 *
 * The box is in the page's own units as the reader sees it — the viewport at
 * scale 1, origin at the top left, already turned by the page's `/Rotate` — so
 * the same numbers lay the line over the page at whatever size it is drawn.
 */
export const ocrLineSchema = z.object({
  text: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().positive(),
});

export type OcrLine = z.infer<typeof ocrLineSchema>;

/** The lines of one page that was read by OCR, top to bottom. */
export const ocrPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  lines: z.array(ocrLineSchema),
});

export type OcrPage = z.infer<typeof ocrPageSchema>;

/**
 * Everything OCR read out of a book: only the pages that needed it, so a page
 * absent here is one whose own text layer pdf.js draws.
 */
export const ocrTextSchema = z.object({
  pages: z.array(ocrPageSchema).min(1),
});

export type OcrText = z.infer<typeof ocrTextSchema>;

/**
 * What OCR read off a book that was stored before it was read
 * (`PUT /api/pdf/:pdfId/ocr`): the book's whole text with the pages OCR read
 * filled in, and the lines of those pages. No pages at all is a reading that
 * found nothing — the book is done, with no text to lay over its pages.
 */
export const saveOcrRequestSchema = z.object({
  fullText: z.string(),
  pages: z.array(ocrPageSchema),
});

export type SaveOcrRequest = z.infer<typeof saveOcrRequestSchema>;

/** The book once its OCR text is stored. */
export const ocrSavedSchema = z.object({ id: z.string(), hasOcr: z.boolean() });

export type OcrSaved = z.infer<typeof ocrSavedSchema>;
