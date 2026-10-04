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

/** The longest name a collection is kept under, after trimming. */
export const MAX_COLLECTION_NAME_LENGTH = 100;

/**
 * One of the reader's collections, with the keys of everything in it — the same
 * keys hiding goes by: a book's id, or a Dropbox id for a file not brought in
 * yet. An entry of the shelf belongs to a collection when any of its files' keys
 * is here (`collectionMembers` on the client).
 */
export const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  keys: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Collection = z.infer<typeof collectionSchema>;

/** Every collection, oldest first. Every write answers with this, the way hiding does. */
export const collectionsSchema = z.object({ collections: z.array(collectionSchema) });

export type Collections = z.infer<typeof collectionsSchema>;

/** A collection's name: trimmed, and something has to be left. */
const collectionNameSchema = z.string().trim().min(1).max(MAX_COLLECTION_NAME_LENGTH);

/**
 * A new collection, with what goes in it straight away — the dialog that puts a
 * book in a collection can make one for it in the same step.
 */
export const createCollectionRequestSchema = z.object({
  name: collectionNameSchema,
  keys: z.array(z.string().min(1).max(200)).max(MAX_HIDE_KEYS).optional(),
});

export type CreateCollectionRequest = z.input<typeof createCollectionRequestSchema>;

export const renameCollectionRequestSchema = z.object({ name: collectionNameSchema });

export type RenameCollectionRequest = z.input<typeof renameCollectionRequestSchema>;

/** Puts keys in a collection (`member: true`) or takes them out. */
export const setCollectionItemsRequestSchema = z.object({
  keys: z.array(z.string().min(1).max(200)).min(1).max(MAX_HIDE_KEYS),
  member: z.boolean(),
});

export type SetCollectionItemsRequest = z.infer<typeof setCollectionItemsRequestSchema>;
