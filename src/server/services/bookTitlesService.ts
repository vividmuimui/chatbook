import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { bookTitles } from "../db/schema";
import { storageFailure, type StorageError } from "./serviceError";

/** Every title the reader gave a Dropbox file that is not a book yet. */
export function listDropboxTitles(
  db: D1Database,
): ResultAsync<{ key: string; title: string }[], StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db).select({ key: bookTitles.key, title: bookTitles.title }).from(bookTitles).all(),
    storageFailure,
  );
}

/**
 * Gives the files a title, or — with null — takes theirs away, so they are
 * called by their file names again. Giving one a title it already has is not
 * an error.
 */
export function setDropboxTitles(
  db: D1Database,
  keys: string[],
  title: string | null,
): ResultAsync<void, StorageError> {
  const orm = drizzle(db);
  const write =
    title === null
      ? orm.delete(bookTitles).where(inArray(bookTitles.key, keys)).run()
      : orm
          .insert(bookTitles)
          .values(keys.map((key) => ({ key, title })))
          .onConflictDoUpdate({ target: bookTitles.key, set: { title } })
          .run();
  return ResultAsync.fromPromise(
    write.then(() => undefined),
    storageFailure,
  );
}
