import type { DropboxFile } from "../../shared/schemas/dropbox";
import type { Collection } from "../../shared/schemas/shelf";
import type { ShelfGroup } from "./shelfGroups";

/**
 * Whether an entry is in a collection: **any** of its files' keys is.
 *
 * The opposite of hiding, which wants every file put away. A title the reader
 * filed stays filed when its other format turns up in Dropbox — it is the title
 * that went in, and a new file of it is no reason for it to leave. Hiding goes
 * the other way because a new file is something the reader has not decided
 * about; a collection is not a decision about files at all.
 */
export function inCollection(group: ShelfGroup, keys: ReadonlySet<string>): boolean {
  return group.members.some((m) => keys.has(m.key));
}

/** The entries of a collection, in the shelf's order. */
export function entriesOf(groups: ShelfGroup[], collection: Collection): ShelfGroup[] {
  const keys = new Set(collection.keys);
  return groups.filter((group) => inCollection(group, keys));
}

/** The entries in no collection at all: 未分類. */
export function unfiledEntries(groups: ShelfGroup[], collections: Collection[]): ShelfGroup[] {
  const filed = new Set(collections.flatMap((c) => c.keys));
  return groups.filter((group) => !inCollection(group, filed));
}

/** The collections an entry is in, by id — what the dialog that files it ticks. */
export function collectionsOf(group: ShelfGroup, collections: Collection[]): Set<string> {
  return new Set(collections.filter((c) => inCollection(group, new Set(c.keys))).map((c) => c.id));
}

/** How many covers a collection's tile stacks. */
export const TILE_COVERS = 4;

/** The books whose covers a collection's tile shows: the first few entries that have one. */
export function tileCovers(entries: ShelfGroup[]): string[] {
  const covers: string[] = [];
  for (const group of entries) {
    const cover = group.members.find((m) => m.kind === "book" && m.book.hasThumbnail);
    if (cover) covers.push(cover.key);
    if (covers.length === TILE_COVERS) break;
  }
  return covers;
}

/**
 * The Dropbox files waiting to be brought in among `entries`, for importing
 * them all at once.
 *
 * A file the reader put away is left out — by its own key, so a hidden format
 * stays out even in an entry that is on the shelf because another of its files
 * is not. Hidden entries are not in `entries` to begin with.
 */
export function filesToImport(
  entries: ShelfGroup[],
  hiddenKeys: ReadonlySet<string>,
): DropboxFile[] {
  return entries.flatMap((group) =>
    group.members.flatMap((m) => (m.kind === "dropbox" && !hiddenKeys.has(m.key) ? [m.file] : [])),
  );
}

/**
 * The collections in the order the shelf lists them: by name, the way a reader
 * looks one up, with the oldest first where names tie.
 */
export function sortCollections(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
