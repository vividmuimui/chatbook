import type { BookFormat, BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";

/**
 * One file of a shelf entry: a book already on the shelf, or a file in the
 * Dropbox folder that has not been opened yet.
 *
 * `key` is what hiding goes by — the book's id, or the Dropbox id — and is the
 * same string the server keeps in `hidden_books`.
 */
export type ShelfMember =
  | { kind: "book"; key: string; format: BookFormat; book: BookSummary }
  | { kind: "dropbox"; key: string; format: BookFormat; file: DropboxFile };

/** The files that share a title, shown as one entry whatever their format. */
export interface ShelfGroup {
  /** The title, normalized the way files are compared. Stable across reloads. */
  id: string;
  /** The title as the first file spelt it, without its extension. */
  title: string;
  /** Books before Dropbox files, and PDF before EPUB inside each. */
  members: ShelfMember[];
}

/** A file name without its `.pdf` / `.epub`. */
export function titleOf(fileName: string): string {
  return fileName.replace(/\.(pdf|epub)$/i, "");
}

/**
 * What decides two files are the same book: their names, less the extension.
 * Case and Unicode normalization are ignored — Dropbox on a Mac hands out
 * decomposed kana, a download gives composed ones, and a reader sees one name.
 */
function groupIdOf(fileName: string): string {
  return titleOf(fileName).normalize("NFC").trim().toLowerCase();
}

function formatOfName(fileName: string): BookFormat {
  return /\.epub$/i.test(fileName) ? "epub" : "pdf";
}

const FORMAT_ORDER: Record<BookFormat, number> = { pdf: 0, epub: 1 };

function memberOrder(member: ShelfMember): number {
  return (member.kind === "book" ? 0 : 10) + FORMAT_ORDER[member.format];
}

/**
 * Gathers the shelf's books and the Dropbox files not yet opened into entries,
 * one per title. Entries come in the order their first file did, so a book the
 * reader already has keeps its place when its other format turns up in Dropbox.
 */
export function groupShelf(books: BookSummary[], files: DropboxFile[]): ShelfGroup[] {
  const groups = new Map<string, ShelfGroup>();

  const add = (fileName: string, member: ShelfMember) => {
    const id = groupIdOf(fileName);
    const group = groups.get(id);
    if (group) group.members.push(member);
    else groups.set(id, { id, title: titleOf(fileName), members: [member] });
  };

  for (const book of books) {
    add(book.fileName, { kind: "book", key: book.id, format: book.format, book });
  }
  for (const file of files) {
    add(file.name, {
      kind: "dropbox",
      key: file.dropboxId,
      format: formatOfName(file.name),
      file,
    });
  }

  const result = [...groups.values()];
  // Array#sort is stable, so equal members keep the order they came in.
  for (const group of result) group.members.sort((a, b) => memberOrder(a) - memberOrder(b));
  return result;
}

/**
 * Splits entries into what the shelf shows and what the reader has put away.
 *
 * An entry is put away only when every file in it is. A new format arriving
 * for a hidden title is a file the reader has not decided about, and the entry
 * comes back to the shelf with it rather than staying out of sight.
 */
export function splitHidden(
  groups: ShelfGroup[],
  hiddenKeys: ReadonlySet<string>,
): { shown: ShelfGroup[]; hidden: ShelfGroup[] } {
  const shown: ShelfGroup[] = [];
  const hidden: ShelfGroup[] = [];
  for (const group of groups) {
    (group.members.every((m) => hiddenKeys.has(m.key)) ? hidden : shown).push(group);
  }
  return { shown, hidden };
}
