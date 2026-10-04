import { z } from "zod";
import { renameBookRequestSchema } from "./book";

/** Most keys one hide/unhide request carries: a group has a file per format, so a handful. */
export const MAX_HIDE_KEYS = 20;

/**
 * The shelf entries the reader has put away: a book's id, or the Dropbox id of
 * a file in the folder that has not been opened yet.
 */
export const hiddenBooksSchema = z.object({ keys: z.array(z.string()) });

export type HiddenBooks = z.infer<typeof hiddenBooksSchema>;

export const setHiddenRequestSchema = z.object({
  keys: z.array(z.string().min(1).max(200)).min(1).max(MAX_HIDE_KEYS),
  hidden: z.boolean(),
});

export type SetHiddenRequest = z.infer<typeof setHiddenRequestSchema>;

/**
 * Titles the reader gave Dropbox files that are not books yet, keyed by their
 * Dropbox id. A book on the shelf carries its own (`BookSummary.title`).
 */
export const dropboxTitlesSchema = z.object({
  titles: z.array(z.object({ key: z.string(), title: z.string() })),
});

export type DropboxTitles = z.infer<typeof dropboxTitlesSchema>;

/**
 * Gives Dropbox files a title, or (blank or null) takes it away. Only Dropbox
 * ids — "id:..." — are taken: a book's title is its own row's
 * (`PATCH /api/pdf/:pdfId`), and a book id stored here would name nothing.
 */
export const setDropboxTitlesRequestSchema = z.object({
  keys: z.array(z.string().max(200).regex(/^id:./)).min(1).max(MAX_HIDE_KEYS),
  title: renameBookRequestSchema.shape.title,
});

export type SetDropboxTitlesRequest = z.input<typeof setDropboxTitlesRequestSchema>;
