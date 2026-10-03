import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { hiddenBooks } from "../db/schema";
import { storageFailure, type StorageError } from "./serviceError";

/** Every key the reader has put away. */
export function listHiddenKeys(db: D1Database): ResultAsync<string[], StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .select({ key: hiddenBooks.key })
      .from(hiddenBooks)
      .all()
      .then((rows) => rows.map((row) => row.key)),
    storageFailure,
  );
}

/** Puts the keys away, or brings them back. Hiding a key already hidden is not an error. */
export function setHidden(
  db: D1Database,
  keys: string[],
  hidden: boolean,
  now: string = new Date().toISOString(),
): ResultAsync<void, StorageError> {
  const orm = drizzle(db);
  const write = hidden
    ? orm
        .insert(hiddenBooks)
        .values(keys.map((key) => ({ key, hiddenAt: now })))
        .onConflictDoNothing()
        .run()
    : orm.delete(hiddenBooks).where(inArray(hiddenBooks.key, keys)).run();
  return ResultAsync.fromPromise(
    write.then(() => undefined),
    storageFailure,
  );
}
