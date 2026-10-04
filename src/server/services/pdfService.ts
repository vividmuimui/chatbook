import { ulid } from "ulid";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, ne } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import { bookTitles, pdfs, selections } from "../db/schema";
import {
  bookFormatSchema,
  pageDirectionSchema,
  type BookFormat,
  type BookOutline,
  type BookRenamed,
  type PageDirection,
  type BookSummary,
  type PdfMetadata,
  type ReadingState,
  type SaveReadingStateRequest,
} from "../../shared/schemas/book";
import {
  positionDataSchema,
  type PositionData,
  type SelectionUpdated,
} from "../../shared/schemas/selection";
import type { BookSearchResult } from "../../shared/schemas/bookSearch";
import type { OcrPage, OcrSaved, OcrText, SaveOcrRequest } from "../../shared/schemas/ocr";
import { findInBookText } from "./bookTextSearch";
import { notFound, storageFailure, type ServiceError, type StorageError } from "./serviceError";

/**
 * R2 object key for a PDF, derived from its content hash.
 */
export function pdfObjectKey(fileHash: string): string {
  return bookObjectKey(fileHash, "pdf");
}

/**
 * R2 object key for a book of either format. PDFs keep the key they always
 * had; an EPUB sits beside them under its own extension.
 */
export function bookObjectKey(fileHash: string, format: BookFormat): string {
  return `pdfs/${fileHash}.${format}`;
}

/** What `/file` serves a book as, and what R2 is told it holds. */
export const BOOK_CONTENT_TYPES: Record<BookFormat, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
};

/**
 * What kind of book a file is, read off its bytes.
 *
 * An EPUB is a ZIP archive, which always opens with the local file header
 * `PK\x03\x04`; a PDF never does. The name the reader gave the file is not
 * asked: it is theirs to call anything, and the viewer chosen from this has to
 * be able to read what is actually there.
 */
export function bookFormatOf(bytes: ArrayBuffer): BookFormat {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  const isZip =
    head.length === 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04;
  return isZip ? "epub" : "pdf";
}

/**
 * A stored format, read forgivingly: the column only ever holds what
 * `bookFormatOf` wrote, but a value nobody recognises is drawn as the format
 * every book had before there was a choice.
 */
export function readFormat(stored: string): BookFormat {
  const parsed = bookFormatSchema.safeParse(stored);
  return parsed.success ? parsed.data : "pdf";
}

/**
 * A stored page direction, read as forgivingly as the format: anything but the
 * two the endpoint writes turns the way every book turned before there was a
 * choice.
 */
export function readPageDirection(stored: string): PageDirection {
  const parsed = pageDirectionSchema.safeParse(stored);
  return parsed.success ? parsed.data : "ltr";
}

/**
 * R2 object key for a PDF's cover thumbnail.
 */
export function thumbnailObjectKey(fileHash: string): string {
  return `thumbnails/${fileHash}.webp`;
}

export const THUMBNAIL_CONTENT_TYPE = "image/webp";

/**
 * R2 object key for the lines OCR read off a scanned book's pages. Kept in R2
 * rather than D1: it is a box per line on every page, a megabyte or so for a
 * long book, and only the viewer reads it — never a query.
 */
export function ocrObjectKey(fileHash: string): string {
  return `ocr/${fileHash}.json`;
}

export const OCR_CONTENT_TYPE = "application/json";

/**
 * The two non-deterministic values every write needs. Injected so tests can
 * pin the ids and timestamps a request produces.
 */
export interface IdClock {
  newId: () => string;
  now: () => string;
}

export const systemIdClock: IdClock = {
  newId: ulid,
  now: () => new Date().toISOString(),
};

export type { PdfMetadata } from "../../shared/schemas/book";

interface OpenPdfInput {
  fileName: string;
  fileHash: string;
  fullText: string;
  pageCount: number;
  arrayBuffer: ArrayBuffer;
  thumbnail?: ArrayBuffer;
  outline?: BookOutline;
  /** What OCR read off pages without text; absent for a book that needed none. */
  ocr?: OcrText;
  /**
   * A book of pictures stored before OCR has read it: its text is still to
   * come (`saveOcrText`), and `fullText` holds only what pdf.js could read.
   */
  ocrPending?: boolean;
  /** The Dropbox file the bytes came from or were written to, when there is one. */
  dropboxId?: string;
}

export type { BookSummary } from "../../shared/schemas/book";

/**
 * List every stored book, most recently opened first, for the shelf view.
 */
export function listPdfs(
  db: D1Database,
  bucket: R2Bucket,
): ResultAsync<BookSummary[], StorageError> {
  return ResultAsync.fromPromise(readShelf(db, bucket), storageFailure);
}

async function readShelf(db: D1Database, bucket: R2Bucket): Promise<BookSummary[]> {
  const rows = await drizzle(db)
    .select({
      id: pdfs.id,
      fileName: pdfs.fileName,
      format: pdfs.format,
      pageCount: pdfs.pageCount,
      fileHash: pdfs.fileHash,
      updatedAt: pdfs.updatedAt,
      dropboxId: pdfs.dropboxId,
      lastReadPage: pdfs.lastReadPage,
      title: pdfs.title,
      ocrStatus: pdfs.ocrStatus,
    })
    .from(pdfs)
    .orderBy(desc(pdfs.updatedAt))
    .all();

  return Promise.all(
    rows.map(async ({ fileHash, dropboxId, format, ocrStatus, ...book }) => ({
      ...book,
      format: readFormat(format),
      ocrPending: ocrStatus === "pending",
      inDropbox: dropboxId !== null,
      hasThumbnail: (await bucket.head(thumbnailObjectKey(fileHash))) !== null,
    })),
  );
}

/**
 * Open (or re-open) a PDF file.
 * Text extraction is done client-side (browser pdf.js), so the server receives
 * pre-computed fileHash, fullText, and pageCount.
 * The PDF binary is stored in R2; D1 keeps the metadata and the object key.
 * Returns the existing record if a file with the same hash already exists.
 */
export function openPdf(
  db: D1Database,
  bucket: R2Bucket,
  input: OpenPdfInput,
  idClock: IdClock = systemIdClock,
): ResultAsync<PdfMetadata, StorageError> {
  return ResultAsync.fromPromise(storePdf(db, bucket, input, idClock), storageFailure);
}

async function storePdf(
  db: D1Database,
  bucket: R2Bucket,
  input: OpenPdfInput,
  idClock: IdClock,
): Promise<PdfMetadata> {
  const {
    fileName,
    fileHash,
    fullText,
    pageCount,
    arrayBuffer,
    thumbnail,
    outline,
    ocr,
    ocrPending,
    dropboxId,
  } = input;
  const d1Db = drizzle(db);
  const format = bookFormatOf(arrayBuffer);
  const objectKey = bookObjectKey(fileHash, format);
  const httpMetadata = { contentType: BOOK_CONTENT_TYPES[format] };
  // Stored like the rest of the metadata: whatever the caller just extracted
  // wins. An upload that extracted none leaves a stored outline alone, though
  // (below): the bytes are the same ones it came from, so it was either read
  // from them on an earlier upload this one failed to repeat, or made by the
  // model for a PDF that has none — and paid for.
  const outlineJson = outline ? JSON.stringify(outline) : null;

  if (thumbnail) {
    await bucket.put(thumbnailObjectKey(fileHash), thumbnail, {
      httpMetadata: { contentType: THUMBNAIL_CONTENT_TYPE },
    });
  }

  if (dropboxId) {
    // A Dropbox file is one book. If it used to be another (its bytes were
    // replaced in Dropbox since), that book keeps its copy in R2 and lets go
    // of the file, rather than the unique index refusing this one.
    await d1Db
      .update(pdfs)
      .set({ dropboxId: null })
      .where(and(eq(pdfs.dropboxId, dropboxId), ne(pdfs.fileHash, fileHash)));
  }

  // A title the reader gave the Dropbox file before it was a book becomes the
  // book's: the file leaves the folder's list of files waiting, and its title
  // goes with it rather than staying behind under a key that is now a book.
  // A title the book already has wins — it is the one the reader has been
  // seeing on the shelf.
  const adoptedTitle = dropboxId ? await takeDropboxTitle(db, dropboxId) : null;

  const existing = await d1Db.select().from(pdfs).where(eq(pdfs.fileHash, fileHash)).get();

  // A book of pictures that OCR has already read keeps what it read when it is
  // added again still waiting for OCR: the bytes are the same ones, and reading
  // them again would cost the reader minutes for the same text.
  const keepsReadText = ocrPending === true && existing?.ocrStatus === "done";
  const ocrStatus = keepsReadText || ocr ? "done" : ocrPending ? "pending" : null;
  if (!keepsReadText) {
    // Otherwise, like the outline, the latest reading wins: a book read again
    // without OCR (its pages turned out to carry text after all), or one whose
    // text is still to be read, must not keep laying the old lines over pages.
    if (ocr) {
      await bucket.put(ocrObjectKey(fileHash), JSON.stringify(ocr), {
        httpMetadata: { contentType: OCR_CONTENT_TYPE },
      });
    } else {
      await bucket.delete(ocrObjectKey(fileHash));
    }
  }

  if (existing) {
    // Re-upload the binary if the object is missing (e.g. bucket was cleared).
    const head = await bucket.head(objectKey);
    if (!head) {
      await bucket.put(objectKey, arrayBuffer, { httpMetadata });
    }

    // Refresh the metadata: the caller just re-extracted it, so it supersedes
    // whatever was stored before. Selections, chats, the reader's place, the
    // title they gave the book and the way its pages turn stay attached to the
    // id — the columns set here are listed one by one so that re-opening a book
    // never costs the reader any of them.
    await d1Db
      .update(pdfs)
      .set({
        fileName,
        ...(keepsReadText ? {} : { fullText }),
        ocrStatus,
        pageCount,
        ...(outlineJson === null ? {} : { outline: outlineJson }),
        updatedAt: idClock.now(),
        // Only ever set here, never cleared: re-uploading a book from disk
        // does not make the Dropbox file stop being it.
        ...(dropboxId ? { dropboxId } : {}),
        ...(existing.title === null && adoptedTitle !== null ? { title: adoptedTitle } : {}),
      })
      .where(eq(pdfs.id, existing.id));

    return {
      id: existing.id,
      fileName,
      format,
      pageCount,
      fullText: keepsReadText ? existing.fullText : fullText,
      readingState: readingStateOf(existing),
      title: existing.title ?? adoptedTitle,
      pageDirection: readPageDirection(existing.pageDirection),
      ocrPending: ocrStatus === "pending",
    };
  }

  await bucket.put(objectKey, arrayBuffer, { httpMetadata });

  const id = idClock.newId();
  const now = idClock.now();

  await d1Db.insert(pdfs).values({
    id,
    filePath: objectKey,
    fileName,
    fileHash,
    fullText,
    pageCount,
    format,
    outline: outlineJson,
    dropboxId: dropboxId ?? null,
    title: adoptedTitle,
    ocrStatus,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    fileName,
    format,
    pageCount,
    fullText,
    readingState: null,
    title: adoptedTitle,
    pageDirection: "ltr",
    ocrPending: ocrStatus === "pending",
  };
}

/**
 * The title the reader gave a Dropbox file while it was not a book, taken out
 * of `book_titles` — it is about to be the book's own. Null when it had none.
 */
async function takeDropboxTitle(db: D1Database, dropboxId: string): Promise<string | null> {
  const taken = await drizzle(db)
    .delete(bookTitles)
    .where(eq(bookTitles.key, dropboxId))
    .returning({ title: bookTitles.title })
    .get();
  return taken?.title ?? null;
}

/**
 * The place a stored book reports, or null for one nobody has read.
 *
 * A page is what makes a place a place: the highlight and the two panels are
 * things that were open at it, so a row without a page has nothing to return
 * to even if those columns hold something.
 */
function readingStateOf(row: {
  lastReadPage: number | null;
  lastReadSelectionId: string | null;
  lastReadSessionId: string | null;
  lastReadOutlineOpen: boolean | null;
  lastReadChatPanelOpen: boolean | null;
}): ReadingState | null {
  if (row.lastReadPage === null) return null;
  return {
    page: row.lastReadPage,
    selectionId: row.lastReadSelectionId,
    sessionId: row.lastReadSessionId,
    outlineOpen: row.lastReadOutlineOpen,
    chatPanelOpen: row.lastReadChatPanelOpen,
  };
}

/**
 * Save where the reader is, so the next device opens the book there.
 *
 * `updatedAt` is deliberately left alone: the shelf is ordered by it, and
 * turning a page is not opening a book again.
 *
 * An omitted panel keeps whatever is stored. Narrow screens leave both out —
 * their outline is a drawer that closes itself on every jump and their chat a
 * sheet, and saving those would fold away what a wide screen deliberately
 * opened.
 */
export function saveReadingState(
  db: D1Database,
  pdfId: string,
  place: SaveReadingStateRequest,
): ResultAsync<void, ServiceError> {
  return ResultAsync.fromPromise(writeReadingState(db, pdfId, place), storageFailure).andThen(
    (saved) => (saved ? ok(undefined) : err(notFound())),
  );
}

async function writeReadingState(
  db: D1Database,
  pdfId: string,
  place: SaveReadingStateRequest,
): Promise<boolean> {
  const updated = await drizzle(db)
    .update(pdfs)
    .set({
      lastReadPage: place.page,
      lastReadSelectionId: place.selectionId,
      ...(place.sessionId === undefined ? {} : { lastReadSessionId: place.sessionId }),
      ...(place.outlineOpen === undefined ? {} : { lastReadOutlineOpen: place.outlineOpen }),
      ...(place.chatPanelOpen === undefined ? {} : { lastReadChatPanelOpen: place.chatPanelOpen }),
    })
    .where(eq(pdfs.id, pdfId))
    .returning({ id: pdfs.id })
    .all();

  return updated.length > 0;
}

/**
 * Give a book the title the reader chose, or — with null — take it away so the
 * book is called by its file name again.
 *
 * `updatedAt` is left alone for the same reason as with the reading place: the
 * shelf is ordered by it, and renaming a book is not opening it.
 */
export function renameBook(
  db: D1Database,
  pdfId: string,
  title: string | null,
): ResultAsync<BookRenamed, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .update(pdfs)
      .set({ title })
      .where(eq(pdfs.id, pdfId))
      .returning({ id: pdfs.id, title: pdfs.title })
      .get(),
    storageFailure,
  ).andThen((renamed) => (renamed ? ok(renamed) : err(notFound())));
}

/**
 * Store what OCR read off a book that was stored before it was read: its whole
 * text, which chat, `/locate` and the text search read from, and the lines laid
 * over its pages (none — a reading that found nothing — leaves no lines). The
 * book is done with OCR afterwards.
 *
 * `updatedAt` is left alone like the reading place: OCR finishing in the
 * background is not the reader opening the book.
 */
export function saveOcrText(
  db: D1Database,
  bucket: R2Bucket,
  pdfId: string,
  { fullText, pages }: SaveOcrRequest,
): ResultAsync<OcrSaved, ServiceError> {
  return ResultAsync.fromPromise(
    writeOcrText(db, bucket, pdfId, fullText, pages),
    storageFailure,
  ).andThen((saved) => (saved ? ok(saved) : err(notFound())));
}

async function writeOcrText(
  db: D1Database,
  bucket: R2Bucket,
  pdfId: string,
  fullText: string,
  pages: OcrPage[],
): Promise<OcrSaved | null> {
  const d1Db = drizzle(db);
  const book = await d1Db
    .select({ fileHash: pdfs.fileHash })
    .from(pdfs)
    .where(eq(pdfs.id, pdfId))
    .get();
  if (!book) return null;

  // R2 before D1: a book that says it is done must have its lines to serve.
  if (pages.length > 0) {
    await bucket.put(ocrObjectKey(book.fileHash), JSON.stringify({ pages } satisfies OcrText), {
      httpMetadata: { contentType: OCR_CONTENT_TYPE },
    });
  } else {
    await bucket.delete(ocrObjectKey(book.fileHash));
  }
  await d1Db.update(pdfs).set({ fullText, ocrStatus: "done" }).where(eq(pdfs.id, pdfId));

  return { id: pdfId, hasOcr: pages.length > 0 };
}

/**
 * Turn the book's pages the other way.
 *
 * Like the reader's place, `updatedAt` is left alone: choosing how a book
 * turns is not opening it again, and the shelf is ordered by that column.
 */
export function savePageDirection(
  db: D1Database,
  pdfId: string,
  pageDirection: PageDirection,
): ResultAsync<PageDirection, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .update(pdfs)
      .set({ pageDirection })
      .where(eq(pdfs.id, pdfId))
      .returning({ pageDirection: pdfs.pageDirection })
      .all(),
    storageFailure,
  ).andThen((updated) =>
    updated.length > 0 ? ok(readPageDirection(updated[0].pageDirection)) : err(notFound()),
  );
}

/**
 * Delete a book together with everything it owns: its selections and chat
 * messages (via the schema's ON DELETE CASCADE) and its R2 objects.
 * D1 is cleared first — if the R2 cleanup then fails, only an unreachable
 * object is left behind, whereas the reverse order would leave a book on the
 * shelf whose binary is gone.
 *
 * "No such book" and "the store refused" both come back as failures now: the
 * old boolean made the first look like a result and left the second to escape
 * as an exception, so the two ends of the same operation were reported in two
 * different ways.
 */
export function deletePdf(
  db: D1Database,
  bucket: R2Bucket,
  pdfId: string,
): ResultAsync<void, ServiceError> {
  return ResultAsync.fromPromise(removePdf(db, bucket, pdfId), storageFailure).andThen((deleted) =>
    deleted ? ok(undefined) : err(notFound()),
  );
}

async function removePdf(db: D1Database, bucket: R2Bucket, pdfId: string): Promise<boolean> {
  const d1Db = drizzle(db);
  const pdf = await d1Db.select().from(pdfs).where(eq(pdfs.id, pdfId)).get();
  if (!pdf) return false;

  await d1Db.delete(pdfs).where(eq(pdfs.id, pdfId));
  // Its Dropbox file goes back to waiting in the folder, under the title the
  // reader gave the book rather than the file's name again.
  if (pdf.dropboxId !== null && pdf.title !== null) {
    await d1Db
      .insert(bookTitles)
      .values({ key: pdf.dropboxId, title: pdf.title })
      .onConflictDoUpdate({ target: bookTitles.key, set: { title: pdf.title } });
  }
  // The key the book was stored under, which carries its format's extension
  await bucket.delete([pdf.filePath, thumbnailObjectKey(pdf.fileHash), ocrObjectKey(pdf.fileHash)]);

  return true;
}

/**
 * The geometry of a stored highlight.
 *
 * Deliberately forgiving, unlike the endpoint that writes it: rows predating
 * the enforced shape carry the viewer's whole measurement, and one row that
 * cannot be read must not take the book it belongs to down with it. Such a
 * highlight is served without rects, so the book still opens and the passage
 * stays in the list.
 */
function readPositionData(stored: string): PositionData {
  try {
    const parsed = positionDataSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
  } catch {
    // Not even JSON — fall through to the empty geometry
  }
  return { rects: [] };
}

/**
 * The book's highlights whose passage, note or chat holds `query`.
 *
 * One statement rather than two searches merged afterwards: a highlight matched
 * by both would otherwise have to be de-duplicated, and the two halves could
 * land at different times.
 */
export function searchSelections(
  db: D1Database,
  pdfId: string,
  query: string,
): ResultAsync<string[], ServiceError> {
  return ResultAsync.fromPromise(findSelections(db, pdfId, query), storageFailure).andThen(
    (found) => (found ? ok(found) : err(notFound())),
  );
}

/**
 * Every place the reader's words are in the book's own text.
 *
 * Reads `full_text` and nothing else: it is the largest column a book has (a
 * couple of hundred KB for a real one), and this is the one answer that needs
 * all of it. The matching itself is `findInBookText`'s.
 */
export function findInBook(
  db: D1Database,
  pdfId: string,
  query: string,
): ResultAsync<BookSearchResult, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db).select({ fullText: pdfs.fullText }).from(pdfs).where(eq(pdfs.id, pdfId)).get(),
    storageFailure,
  ).andThen((book) => (book ? ok(findInBookText(book.fullText, query)) : err(notFound())));
}

/**
 * `%` and `_` are LIKE's own; a reader typing one means the character.
 *
 * Without this a search for "%" answers with the whole book — which reads as
 * the search being broken rather than as a wildcard being honoured.
 */
function likeContaining(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function findSelections(
  db: D1Database,
  pdfId: string,
  query: string,
): Promise<string[] | null> {
  const d1Db = drizzle(db);
  const book = await d1Db.select({ id: pdfs.id }).from(pdfs).where(eq(pdfs.id, pdfId)).get();
  if (!book) return null;

  const needle = likeContaining(query);
  const rows = await db
    .prepare(
      `SELECT s.id FROM selections s
       WHERE s.pdf_id = ?1
         AND (s.selected_text LIKE ?2 ESCAPE '\\'
              OR s.note LIKE ?2 ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM chat_messages m
                         WHERE m.selection_id = s.id AND m.content LIKE ?2 ESCAPE '\\'))
       ORDER BY s.created_at DESC`,
    )
    .bind(pdfId, needle)
    .all<{ id: string }>();

  return rows.results.map((row) => row.id);
}

/**
 * Change the colour or the note of one of a book's highlights.
 *
 * A field left undefined keeps what is stored; a note of null takes it away.
 * NOT_FOUND when the highlight is not in that book — including when it is in
 * another one, so a request naming the wrong book cannot reach it.
 */
export function updateSelection(
  db: D1Database,
  pdfId: string,
  selectionId: string,
  change: { color?: string; note?: string | null },
): ResultAsync<SelectionUpdated, ServiceError> {
  return ResultAsync.fromPromise(
    writeSelection(db, pdfId, selectionId, change),
    storageFailure,
  ).andThen((updated) => (updated ? ok(updated) : err(notFound())));
}

async function writeSelection(
  db: D1Database,
  pdfId: string,
  selectionId: string,
  change: { color?: string; note?: string | null },
): Promise<SelectionUpdated | null> {
  const owned = and(eq(selections.id, selectionId), eq(selections.pdfId, pdfId));
  const updated = await drizzle(db)
    .update(selections)
    .set({
      ...(change.color === undefined ? {} : { color: change.color }),
      ...(change.note === undefined ? {} : { note: change.note }),
    })
    .where(owned)
    .returning({ id: selections.id, color: selections.color, note: selections.note })
    .get();

  return updated ?? null;
}

/**
 * Get a PDF record by id, including its selections.
 */
export function getPdf(db: D1Database, bucket: R2Bucket, pdfId: string) {
  return ResultAsync.fromPromise(readPdf(db, bucket, pdfId), storageFailure).andThen((book) =>
    book ? ok(book) : err(notFound()),
  );
}

async function readPdf(db: D1Database, bucket: R2Bucket, pdfId: string) {
  const d1Db = drizzle(db);
  const pdf = await d1Db.select().from(pdfs).where(eq(pdfs.id, pdfId)).get();
  if (!pdf) return null;

  // Asked for together: the highlights and the cover do not depend on each
  // other, and awaiting them in turn made opening a book wait out two round
  // trips where one would do.
  // The OCR head joins them for the same reason: alongside, it costs the
  // opening of a book no round trip of its own.
  const [selRows, thumbnail, ocr] = await Promise.all([
    d1Db.select().from(selections).where(eq(selections.pdfId, pdfId)).all(),
    bucket.head(thumbnailObjectKey(pdf.fileHash)),
    bucket.head(ocrObjectKey(pdf.fileHash)),
  ]);

  return {
    id: pdf.id,
    fileName: pdf.fileName,
    format: readFormat(pdf.format),
    pageCount: pdf.pageCount,
    hasThumbnail: thumbnail !== null,
    hasOutline: pdf.outline !== null,
    hasOcr: ocr !== null,
    ocrPending: pdf.ocrStatus === "pending",
    readingState: readingStateOf(pdf),
    title: pdf.title,
    pageDirection: readPageDirection(pdf.pageDirection),
    selections: selRows.map((s) => ({
      id: s.id,
      selectedText: s.selectedText,
      pageNumber: s.pageNumber,
      positionData: readPositionData(s.positionData),
      color: s.color,
      note: s.note,
      createdAt: s.createdAt,
    })),
  };
}
