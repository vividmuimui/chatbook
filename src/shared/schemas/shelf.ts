import { z } from "zod";

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
