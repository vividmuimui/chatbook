import { describe, it, expect } from "vite-plus/test";
import { groupShelf, splitHidden } from "./shelfGroups";
import {
  collectionsOf,
  entriesOf,
  filesToImport,
  sortCollections,
  tileCovers,
  unfiledEntries,
} from "./shelfCollections";
import type { BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";
import type { Collection } from "../../shared/schemas/shelf";

function book(id: string, fileName: string, overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    title: null,
    id,
    fileName,
    format: fileName.endsWith(".epub") ? "epub" : "pdf",
    pageCount: 10,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
    lastReadPage: null,
    ...overrides,
  };
}

function file(dropboxId: string, name: string): DropboxFile {
  return { dropboxId, name, path: `/${name}`, size: 1 };
}

function collection(id: string, name: string, keys: string[]): Collection {
  return { id, name, keys, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

const titlesOf = (groups: { title: string }[]) => groups.map((g) => g.title);

describe("entriesOf", () => {
  it("takes an entry in when any one of its files is in the collection", () => {
    // The PDF went in; the EPUB of the same title turned up in Dropbox later.
    const groups = groupShelf(
      [book("pdf", "Rust.pdf"), book("zig", "Zig.pdf")],
      [file("id:epub", "Rust.epub")],
    );

    expect(titlesOf(entriesOf(groups, collection("c", "技術書", ["pdf"])))).toStrictEqual(["Rust"]);
  });

  it("knows a Dropbox file not brought in yet by its Dropbox id", () => {
    const groups = groupShelf([book("a", "Rust.pdf")], [file("id:zig", "Zig.pdf")]);

    expect(titlesOf(entriesOf(groups, collection("c", "積読", ["id:zig"])))).toStrictEqual(["Zig"]);
  });
});

describe("unfiledEntries", () => {
  it("keeps only what is in no collection", () => {
    const groups = groupShelf(
      [book("a", "Rust.pdf"), book("b", "Zig.pdf"), book("c", "Go.pdf")],
      [],
    );
    const collections = [collection("1", "x", ["a"]), collection("2", "y", ["a", "c"])];

    expect(titlesOf(unfiledEntries(groups, collections))).toStrictEqual(["Zig"]);
  });
});

describe("collectionsOf", () => {
  it("names every collection an entry is in, one book in several", () => {
    const [rust] = groupShelf([book("a", "Rust.pdf"), book("b", "Rust.epub")], []);
    const collections = [
      collection("1", "x", ["b"]),
      collection("2", "y", ["z"]),
      collection("3", "z", ["a"]),
    ];

    expect(collectionsOf(rust, collections)).toStrictEqual(new Set(["1", "3"]));
  });
});

describe("tileCovers", () => {
  it("takes the first four entries with a cover, by the book that has it", () => {
    const groups = groupShelf(
      [
        book("a", "A.pdf", { hasThumbnail: true }),
        book("b", "B.pdf"),
        book("c", "C.pdf", { hasThumbnail: true }),
        book("d", "D.pdf", { hasThumbnail: true }),
        book("e", "E.pdf", { hasThumbnail: true }),
        book("f", "F.pdf", { hasThumbnail: true }),
      ],
      [file("id:g", "G.pdf")],
    );

    expect(tileCovers(groups)).toStrictEqual(["a", "c", "d", "e"]);
  });
});

describe("filesToImport", () => {
  it("takes the entries' Dropbox files, leaving out a file put away by itself", () => {
    const groups = groupShelf(
      [book("a", "Rust.pdf")],
      [file("id:epub", "Rust.epub"), file("id:zig", "Zig.pdf"), file("id:go", "Go.pdf")],
    );
    const hidden = new Set(["id:go", "id:epub"]);
    const { shown } = splitHidden(groups, hidden);

    // Rust is on the shelf (its PDF is not hidden), but its hidden EPUB stays out
    expect(filesToImport(shown, hidden).map((f) => f.dropboxId)).toStrictEqual(["id:zig"]);
  });
});

describe("sortCollections", () => {
  it("lists collections by name", () => {
    const sorted = sortCollections([
      collection("1", "積読", []),
      collection("2", "Rust", []),
      collection("3", "技術書", []),
    ]);

    expect(sorted.map((c) => c.name)).toStrictEqual(["Rust", "技術書", "積読"]);
  });
});
