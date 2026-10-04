import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import { collectionItems, collections } from "../db/schema";
import type { Collection } from "../../shared/schemas/shelf";
// Type only: pdfService calls into this module during the import and deletion.
import type { IdClock } from "./pdfService";
import { notFound, storageFailure, type ServiceError, type StorageError } from "./serviceError";

/** Every collection, oldest first, each with the keys in it in the order they went in. */
export function listCollections(db: D1Database): ResultAsync<Collection[], StorageError> {
  return ResultAsync.fromPromise(readCollections(db), storageFailure);
}

async function readCollections(db: D1Database): Promise<Collection[]> {
  const orm = drizzle(db);
  const [rows, items] = await Promise.all([
    orm.select().from(collections).orderBy(asc(collections.createdAt), asc(collections.id)).all(),
    orm
      .select({ collectionId: collectionItems.collectionId, key: collectionItems.key })
      .from(collectionItems)
      .orderBy(asc(collectionItems.addedAt))
      .all(),
  ]);
  const keysOf = new Map<string, string[]>();
  for (const { collectionId, key } of items) {
    const keys = keysOf.get(collectionId) ?? [];
    keys.push(key);
    keysOf.set(collectionId, keys);
  }
  return rows.map((row) => ({ ...row, keys: keysOf.get(row.id) ?? [] }));
}

/** Makes a collection, with whatever it is handed already in it. */
export function createCollection(
  db: D1Database,
  name: string,
  keys: string[],
  idClock: IdClock,
): ResultAsync<void, StorageError> {
  const id = idClock.newId();
  const now = idClock.now();
  const orm = drizzle(db);
  const write = async () => {
    const create = orm.insert(collections).values({ id, name, createdAt: now, updatedAt: now });
    if (keys.length === 0) {
      await create.run();
      return;
    }
    // One batch, so a collection never exists without what it was made for.
    await orm.batch([
      create,
      orm
        .insert(collectionItems)
        .values([...new Set(keys)].map((key) => ({ collectionId: id, key, addedAt: now })))
        .onConflictDoNothing(),
    ]);
  };
  return ResultAsync.fromPromise(write(), storageFailure);
}

export function renameCollection(
  db: D1Database,
  id: string,
  name: string,
  now: string = new Date().toISOString(),
): ResultAsync<void, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .update(collections)
      .set({ name, updatedAt: now })
      .where(eq(collections.id, id))
      .returning({ id: collections.id })
      .all(),
    storageFailure,
  ).andThen((updated) => (updated.length > 0 ? ok(undefined) : err(notFound())));
}

/** Deletes a collection and what it lists (ON DELETE CASCADE). The books stay. */
export function deleteCollection(db: D1Database, id: string): ResultAsync<void, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .delete(collections)
      .where(eq(collections.id, id))
      .returning({ id: collections.id })
      .all(),
    storageFailure,
  ).andThen((deleted) => (deleted.length > 0 ? ok(undefined) : err(notFound())));
}

/**
 * Puts keys in a collection, or takes them out. Putting in a key already there,
 * or taking out one that is not, is not an error.
 */
export function setCollectionItems(
  db: D1Database,
  id: string,
  keys: string[],
  member: boolean,
  now: string = new Date().toISOString(),
): ResultAsync<void, ServiceError> {
  const orm = drizzle(db);
  const write = async (): Promise<boolean> => {
    const touched = await orm
      .update(collections)
      .set({ updatedAt: now })
      .where(eq(collections.id, id))
      .returning({ id: collections.id })
      .all();
    if (touched.length === 0) return false;
    if (member) {
      await orm
        .insert(collectionItems)
        .values([...new Set(keys)].map((key) => ({ collectionId: id, key, addedAt: now })))
        .onConflictDoNothing()
        .run();
    } else {
      await orm
        .delete(collectionItems)
        .where(and(eq(collectionItems.collectionId, id), inArray(collectionItems.key, keys)))
        .run();
    }
    return true;
  };
  return ResultAsync.fromPromise(write(), storageFailure).andThen((found) =>
    found ? ok(undefined) : err(notFound()),
  );
}

/**
 * Moves every collection's rows from one key to another — a Dropbox file onto
 * the book it has just become, or a deleted book back onto its file. Where the
 * other key is already in a collection the row is simply dropped: the entry is
 * in it either way.
 *
 * Thrown rather than wrapped: it runs inside the import and the deletion, whose
 * own `ResultAsync` reports the store refusing.
 */
export async function moveCollectionKey(db: D1Database, from: string, to: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE OR IGNORE collection_items SET key = ? WHERE key = ?").bind(to, from),
    db.prepare("DELETE FROM collection_items WHERE key = ?").bind(from),
  ]);
}

/** Takes a key out of every collection: a book deleted with no file to go back to. */
export async function dropCollectionKey(db: D1Database, key: string): Promise<void> {
  await drizzle(db).delete(collectionItems).where(eq(collectionItems.key, key)).run();
}
