import { EpubError, openEpub, type EpubBook } from "./epub";
import { chapterPlainText, renderChapter } from "./epubContent";
import { toStoredOutline, type OutlineEntry } from "./pdfOutline";
import { THUMBNAIL_WIDTH, bytesToBase64, computeHash, type ExtractedPdfData } from "./pdfLoader";

/**
 * Draw the book's cover image small, as a webp for the shelf. Null when the
 * book names no cover or the browser cannot decode it — the shelf then shows
 * the title instead, as it does for a PDF whose first page would not render.
 */
export async function renderEpubCover(book: EpubBook): Promise<Blob | null> {
  try {
    const bytes = book.coverPath ? book.file(book.coverPath) : null;
    if (!book.coverPath || !bytes) return null;

    const bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: book.mediaType(book.coverPath) ?? "" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = Math.round((bitmap.height / bitmap.width) * THUMBNAIL_WIDTH);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.8);
    });
  } catch {
    // The same deliberate silence as a PDF's cover (`renderCoverThumbnail`):
    // a cover is decoration, and the shelf draws the title in its place.
    return null;
  }
}

/**
 * The table of contents as the server keeps it for an EPUB: its top-level
 * entries, with those that open in the same item of the spine said as one.
 *
 * The server cuts a book into chapters by the page each starts on, and an
 * EPUB's page is an item of its spine. A book whose contents list 7.1 to 7.5
 * side by side, all inside the one file of chapter 7, would come back from it as
 * a single chapter called 「7.1 …」 — and a reader picking that in the chat's
 * scope menu would think they were asking about 7.1 alone. Named together, the
 * span says what it holds.
 */
export function epubOutlineEntries(entries: OutlineEntry[]): OutlineEntry[] {
  const merged: OutlineEntry[] = [];
  for (const entry of entries) {
    const last = merged.at(-1);
    if (last && entry.pageNumber !== null && last.pageNumber === entry.pageNumber) {
      merged[merged.length - 1] = { ...last, title: `${last.title}・${entry.title}` };
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Read an EPUB the reader chose into what the server stores: each chapter's
 * text, joined with a form feed exactly as a PDF's pages are, so chat excerpts,
 * citations and `/locate` treat a chapter as the page it stands in for.
 */
export async function extractEpubData(file: File): Promise<ExtractedPdfData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hashPromise = computeHash(bytes);
  const book = openEpub(bytes);

  // Images are left out: the text is all chat is sent, and no chapter drawn
  // here is ever looked at.
  const chapterTexts = book.chapters.map((chapter) =>
    chapterPlainText(renderChapter(chapter.source, chapter.path, { imageUrl: () => null })),
  );
  if (chapterTexts.every((text) => text === "")) {
    throw new EpubError("EPUBに本文がありません");
  }

  return {
    fileName: file.name,
    fileHash: await hashPromise,
    fullText: chapterTexts.join("\f"),
    pageCount: book.chapters.length,
    fileContentBase64: bytesToBase64(bytes),
    thumbnail: await renderEpubCover(book),
    outline: toStoredOutline(epubOutlineEntries(book.outline)),
    // A chapter is markup, so there is always text to read without OCR
    needsOcr: false,
  };
}
