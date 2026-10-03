import { z } from "zod";

/** Longest folder path the settings accept. Dropbox paths are far shorter in practice. */
export const MAX_DROPBOX_FOLDER_LENGTH = 1000;

/**
 * A folder path the way it is stored and shown: a leading slash, no trailing
 * one, and `/` for the root of the Dropbox.
 *
 * Returns null for something that cannot be a folder path at all (empty, or a
 * path with an empty segment such as `/a//b`), so the reader is told before the
 * server is asked.
 */
export function normalizeDropboxFolder(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const segments = trimmed.split("/").filter((segment, i, all) => {
    // A leading and a trailing slash are spelling, not segments.
    return !(segment === "" && (i === 0 || i === all.length - 1));
  });
  if (segments.some((segment) => segment.trim() === "")) return null;
  return `/${segments.join("/")}`;
}

/** What `/api/dropbox/settings` reports and what saving the folder answers. */
export const dropboxSettingsSchema = z.object({
  // Whether the deploy holds Dropbox credentials. Without them there is no
  // folder to choose, and uploads stay in R2 alone.
  available: z.boolean(),
  folder: z.string().nullable(),
});

export type DropboxSettings = z.infer<typeof dropboxSettingsSchema>;

export const saveDropboxFolderRequestSchema = z.object({
  folder: z.string().max(MAX_DROPBOX_FOLDER_LENGTH),
});

export type SaveDropboxFolderRequest = z.infer<typeof saveDropboxFolderRequestSchema>;

/** A PDF or EPUB in the Dropbox folder that is not on the shelf yet. */
export const dropboxFileSchema = z.object({
  /** Dropbox's own id ("id:..."), which survives a rename or a move. */
  dropboxId: z.string(),
  name: z.string(),
  /** Where it sits, relative to the chosen folder, e.g. `/rust/book.pdf`. */
  path: z.string(),
  size: z.number().int().nonnegative(),
});

export type DropboxFile = z.infer<typeof dropboxFileSchema>;

/**
 * The folder as the shelf shows it. Three states rather than an error for the
 * first two: a deploy without Dropbox and a reader who has not picked a folder
 * yet are both normal, and neither is something to put in a red band.
 */
export const dropboxFolderListingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unavailable") }),
  z.object({ state: z.literal("no-folder") }),
  z.object({
    state: z.literal("ready"),
    folder: z.string(),
    files: z.array(dropboxFileSchema),
  }),
]);

export type DropboxFolderListing = z.infer<typeof dropboxFolderListingSchema>;
