import type { BookFormat, BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";
import { titleOf } from "./bookTitle";

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
  /**
   * The title the reader gave a book of the entry, or else the title as the
   * first file spelt it, without its extension.
   */
  title: string;
  /** The preferred format first, and books before Dropbox files inside each. */
  members: ShelfMember[];
}

/**
 * What decides two files are the same book: their names, less the extension.
 * Case and Unicode normalization are ignored — Dropbox on a Mac hands out
 * decomposed kana, a download gives composed ones, and a reader sees one name.
 */
function groupIdOf(fileName: string): string {
  return comparable(titleOf(fileName));
}

/** Text the way titles are compared: composed, trimmed, and in one case. */
function comparable(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

function formatOfName(fileName: string): BookFormat {
  return /\.epub$/i.test(fileName) ? "epub" : "pdf";
}

/**
 * Where a file stands in its entry, lowest first: the entry's cover and title
 * open the first one.
 *
 * **The preferred format wins over being on the shelf already.** A reader who
 * chose EPUB and has only the PDF imported gets the EPUB fetched from Dropbox
 * when they open the title — once, after which it is on the shelf too. Putting
 * imported books first instead would leave the setting doing nothing for
 * exactly the title whose other format has just turned up in Dropbox, and
 * open the PDF they said they did not prefer. Inside one format a book on the
 * shelf comes before a Dropbox file, which costs nothing to open.
 */
function memberOrder(member: ShelfMember, preferred: BookFormat): number {
  return (member.format === preferred ? 0 : 10) + (member.kind === "book" ? 0 : 1);
}

/**
 * Gathers the shelf's books and the Dropbox files not yet opened into entries,
 * one per title. Entries come in the order their first file did, so a book the
 * reader already has keeps its place when its other format turns up in Dropbox.
 *
 * **A renamed book is gathered by the title the reader gave it** — that is the
 * name the reader sees, and two books they called the same are one book to
 * them, whatever their files are called. A file that still bears the name the
 * book had before it was renamed follows it into the new entry (`renamedFrom`):
 * the Dropbox files are named by the reader's file system, which the rename
 * never touches, and the EPUB of a renamed PDF would otherwise be left on the
 * shelf under the name the reader replaced.
 */
export function groupShelf(
  books: BookSummary[],
  files: DropboxFile[],
  preferred: BookFormat = "pdf",
): ShelfGroup[] {
  const groups = new Map<string, ShelfGroup>();
  // Entries whose title is one the reader wrote, which no file name overrides.
  const titledByReader = new Set<string>();

  // A renamed book's file name, pointing at the entry its new title makes. A
  // file still called what the book was called before — its Dropbox copy in the
  // other format, or that format once it is brought in and not renamed yet —
  // is the same book, and goes where the book went. Read in a pass of its own
  // so the order books arrive in does not decide it.
  const renamedFrom = new Map<string, string>();
  for (const book of books) {
    const id = book.title === null ? null : comparable(book.title);
    if (id !== null && !renamedFrom.has(groupIdOf(book.fileName))) {
      renamedFrom.set(groupIdOf(book.fileName), id);
    }
  }

  const add = (fileName: string, title: string | null, member: ShelfMember) => {
    const id =
      title === null
        ? (renamedFrom.get(groupIdOf(fileName)) ?? groupIdOf(fileName))
        : comparable(title);
    let group = groups.get(id);
    if (!group) {
      group = { id, title: title ?? titleOf(fileName), members: [] };
      groups.set(id, group);
    }
    group.members.push(member);
    // The first title the reader wrote names the entry, even where a file that
    // followed the renamed book here arrived first.
    if (title !== null && !titledByReader.has(id)) {
      titledByReader.add(id);
      group.title = title;
    }
  };

  for (const book of books) {
    add(book.fileName, book.title, { kind: "book", key: book.id, format: book.format, book });
  }
  for (const file of files) {
    add(file.name, null, {
      kind: "dropbox",
      key: file.dropboxId,
      format: formatOfName(file.name),
      file,
    });
  }

  const result = [...groups.values()];
  // Array#sort is stable, so equal members keep the order they came in.
  for (const group of result) {
    group.members.sort((a, b) => memberOrder(a, preferred) - memberOrder(b, preferred));
  }
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

/**
 * The entries whose title holds what the reader typed, in the shelf's order.
 *
 * Compared the way names are when the shelf gathers them (see `groupIdOf`), so
 * a title is found whatever case or Unicode form the reader typed it in. The
 * extension is not part of a title and does not match. An empty query, or one
 * of spaces only, keeps everything.
 */
export function filterShelf(groups: ShelfGroup[], query: string): ShelfGroup[] {
  const wanted = comparable(query);
  if (wanted === "") return groups;
  return groups.filter((group) => group.id.includes(wanted));
}
