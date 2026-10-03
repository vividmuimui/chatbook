import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { settings } from "../db/schema";
import { storageFailure, type StorageError } from "./serviceError";

const DROPBOX_FOLDER = "dropbox_folder";

/** The Dropbox folder the shelf reads, or null when none has been chosen. */
export function getDropboxFolder(db: D1Database): ResultAsync<string | null, StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, DROPBOX_FOLDER))
      .get()
      .then((row) => row?.value ?? null),
    storageFailure,
  );
}

/** Stores the folder, already normalized (`normalizeDropboxFolder`). */
export function saveDropboxFolder(db: D1Database, folder: string): ResultAsync<void, StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .insert(settings)
      .values({ key: DROPBOX_FOLDER, value: folder })
      .onConflictDoUpdate({ target: settings.key, set: { value: folder } })
      .run()
      .then(() => undefined),
    storageFailure,
  );
}
