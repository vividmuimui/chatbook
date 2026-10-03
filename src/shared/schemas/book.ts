import { z } from "zod";
import { selectionHighlightSchema } from "./selection";

/**
 * What kind of file a book is, which decides how it is drawn.
 *
 * An EPUB has no pages of its own, so each chapter (each item of its spine)
 * stands in for one: `pageCount`, `pageNumber` and the reading place all count
 * chapters there, and the rest of the app — chat excerpts, citations, the
 * outline — works on them unchanged.
 */
export const bookFormatSchema = z.enum(["pdf", "epub"]);

export type BookFormat = z.infer<typeof bookFormatSchema>;

/**
 * Which way a book's pages turn.
 *
 * `ltr` opens on the left and is read left to right — a book set horizontally,
 * and every book stored before there was a choice. `rtl` opens on the right: a
 * book set vertically in Japanese, or a manga, whose next page is on the left.
 * It is the reader's to choose, book by book; a PDF does not say.
 *
 * What it changes is only where "previous" and "next" are on the screen. What
 * a turn means — which page comes next — is the same both ways.
 */
export const pageDirectionSchema = z.enum(["ltr", "rtl"]);

export type PageDirection = z.infer<typeof pageDirectionSchema>;

/** What a device sends to turn a book the other way. */
export const savePageDirectionRequestSchema = z.object({ pageDirection: pageDirectionSchema });

export type SavePageDirectionRequest = z.infer<typeof savePageDirectionRequestSchema>;

/** The direction as the server now holds it. */
export const pageDirectionSavedSchema = z.object({ pageDirection: pageDirectionSchema });

/** A book as the shelf shows it. */
export const bookSummarySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  format: bookFormatSchema,
  pageCount: z.number().int().positive(),
  updatedAt: z.string(),
  hasThumbnail: z.boolean(),
  // Whether the book is a file in the Dropbox folder. Deleting it from the
  // shelf leaves that file alone, and the reader is told so before agreeing.
  inDropbox: z.boolean(),
  // The page the reader last had open, for the shelf's progress. `null` for a
  // book never opened in a reader — which is not the same as page 1.
  lastReadPage: z.number().int().nullable(),
});

export type BookSummary = z.infer<typeof bookSummarySchema>;

export const bookListSchema = z.object({ books: z.array(bookSummarySchema) });

/**
 * Where the reader left off, as every device that opens the book gets it.
 *
 * The five travel together because they were saved together: the page, the
 * chat that was open on it — a highlight's, or the book's own — and whether the
 * outline and the chat pane sat beside them. `null` for either panel is "no
 * wide screen has said either way" — narrow screens do not save them, since
 * there the outline is a drawer and the chat a sheet over the page rather than
 * places next to it. `bookChat` is part of the place rather than of the panels
 * for the opposite reason: a narrow screen has a conversation open on the book
 * too.
 */
export const readingStateSchema = z.object({
  page: z.number().int().positive(),
  selectionId: z.string().nullable(),
  // True when the conversation open was the book's own rather than a
  // highlight's; at most one of the two is set. Null on a place saved before
  // this was recorded, which reads as no conversation open.
  bookChat: z.boolean().nullable(),
  outlineOpen: z.boolean().nullable(),
  chatPanelOpen: z.boolean().nullable(),
});

export type ReadingState = z.infer<typeof readingStateSchema>;

/**
 * What a device sends to save its place. The two panels are optional rather
 * than nullable: leaving them out keeps whatever was stored, which is how a
 * narrow screen saves a page without folding away what a wide screen opened.
 * `bookChat` is optional for the same reason rather than for that one: a device
 * that does not say keeps what was there.
 */
export const saveReadingStateRequestSchema = z.object({
  page: z.number().int().positive(),
  selectionId: z.string().nullable(),
  bookChat: z.boolean().optional(),
  outlineOpen: z.boolean().optional(),
  chatPanelOpen: z.boolean().optional(),
});

export type SaveReadingStateRequest = z.infer<typeof saveReadingStateRequestSchema>;

export const readingStateSavedSchema = z.object({ saved: z.literal(true) });

/**
 * Limits the server holds a stored outline to. The client clamps to the same
 * numbers before sending (pdfOutline.ts の toStoredOutline) — the outline is
 * only decoration for chat, so an outline past these bounds is trimmed there
 * rather than turned into a 400 that costs the reader the whole upload.
 */
export const MAX_OUTLINE_CHAPTERS = 1000;
export const MAX_OUTLINE_TITLE_LENGTH = 500;

/**
 * One top-level chapter of the book's table of contents, as the client
 * resolved it from the PDF's outline at upload time. Entries whose
 * destination cannot be resolved to a page are dropped before sending, so
 * `pageNumber` is never null here.
 */
export const outlineChapterSchema = z.object({
  title: z.string().max(MAX_OUTLINE_TITLE_LENGTH),
  pageNumber: z.number().int().positive(),
});

export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

/**
 * The stored table of contents. A book with no outline omits the field
 * entirely rather than sending an empty array — both mean the same fallback
 * (a page window around the highlight), so the distinction is not kept.
 */
export const bookOutlineSchema = z.array(outlineChapterSchema).min(1).max(MAX_OUTLINE_CHAPTERS);

export type BookOutline = z.infer<typeof bookOutlineSchema>;

/**
 * One part of the book a question can be aimed at, with the pages it covers.
 *
 * The pages ahead of the first chapter come back with no title of their own —
 * the spans tile the book between them, so nothing is left that a reader
 * cannot ask about.
 */
export const bookChapterSchema = z.object({
  title: z.string().nullable(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
});

export type BookChapter = z.infer<typeof bookChapterSchema>;

export const chapterListSchema = z.object({ chapters: z.array(bookChapterSchema) });

/** What opening a PDF returns: the metadata the reader needs to render it. */
export const pdfMetadataSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  format: bookFormatSchema,
  pageCount: z.number().int().positive(),
  fullText: z.string(),
  // Carried here too: the picker seeds the cache from this answer, and a seed
  // without the place would open an already-read book at page 1.
  readingState: readingStateSchema.nullable(),
  // Likewise: a right-opening book added again would otherwise open turning
  // the wrong way until the book was read back.
  pageDirection: pageDirectionSchema,
});

export type PdfMetadata = z.infer<typeof pdfMetadataSchema>;

/** A book with the highlights made in it. */
export const bookDetailSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  format: bookFormatSchema,
  pageCount: z.number().int().positive(),
  hasThumbnail: z.boolean(),
  // Like hasThumbnail, this is what tells the reader whether to backfill: a
  // book stored before outlines were kept gets its chapters extracted from
  // the document the reader has open anyway (usePdfDocument).
  hasOutline: z.boolean(),
  selections: z.array(selectionHighlightSchema),
  readingState: readingStateSchema.nullable(),
  pageDirection: pageDirectionSchema,
});

export type BookDetail = z.infer<typeof bookDetailSchema>;

/**
 * Longest passage `/locate` will look for. A quoted passage is a sentence or
 * two; beyond this the request is not a lookup, and each one scans the whole
 * book character by character.
 */
export const MAX_LOCATE_TEXT_LENGTH = 2000;

export const locateQuerySchema = z.object({
  text: z.string().min(1).max(MAX_LOCATE_TEXT_LENGTH),
});

/**
 * Why a quoted passage has no page. Each one is a different thing to tell the
 * reader: a quote that is nowhere in the book is a sign the model reworded it,
 * while a book of one page simply has nowhere to jump to.
 */
export const pageMissSchema = z.enum(["no-quote", "not-in-book", "single-page-book"]);

export type PageMiss = z.infer<typeof pageMissSchema>;

/** Where a passage quoted from a `#:~:text=` link lives, or why it has no page. */
export const locatedPageSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), pageNumber: z.number().int().positive() }),
  z.object({ found: z.literal(false), miss: pageMissSchema }),
]);

export type LocatedPage = z.infer<typeof locatedPageSchema>;

export const bookDeletedSchema = z.object({ deleted: z.literal(true) });

export const thumbnailStoredSchema = z.object({ stored: z.literal(true) });

export const outlineStoredSchema = z.object({ stored: z.literal(true) });

/** What asking the model for a table of contents stored. */
export const generatedOutlineSchema = z.object({ outline: bookOutlineSchema });

export type GeneratedOutline = z.infer<typeof generatedOutlineSchema>;
