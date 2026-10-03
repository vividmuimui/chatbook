import { describe, it, expect } from "vite-plus/test";
import { filterShelf, groupShelf, splitHidden } from "./shelfGroups";
import type { BookSummary } from "../../shared/schemas/book";
import type { DropboxFile } from "../../shared/schemas/dropbox";

function book(id: string, fileName: string, format: "pdf" | "epub" = "pdf"): BookSummary {
  return {
    title: null,
    id,
    fileName,
    format,
    pageCount: 10,
    updatedAt: "2026-01-01T00:00:00Z",
    hasThumbnail: false,
    inDropbox: false,
    lastReadPage: null,
  };
}

function file(dropboxId: string, name: string): DropboxFile {
  return { dropboxId, name, path: `/${name}`, size: 1 };
}

describe("groupShelf", () => {
  it("puts a PDF and an EPUB of the same name into one entry", () => {
    const groups = groupShelf([book("a", "Rust入門.pdf"), book("b", "Rust入門.epub", "epub")], []);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Rust入門");
    expect(groups[0].members.map((m) => m.key)).toStrictEqual(["a", "b"]);
  });

  it("joins a Dropbox file to the book it shares a name with, books first", () => {
    const groups = groupShelf([book("a", "Rust入門.pdf")], [file("id:1", "Rust入門.epub")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => [m.kind, m.format])).toStrictEqual([
      ["book", "pdf"],
      ["dropbox", "epub"],
    ]);
  });

  it("orders PDF before EPUB whichever arrived first", () => {
    const groups = groupShelf([book("b", "x.epub", "epub"), book("a", "x.pdf")], []);

    expect(groups[0].members.map((m) => m.format)).toStrictEqual(["pdf", "epub"]);
  });

  it("puts the preferred format first when the reader prefers EPUB", () => {
    const groups = groupShelf([book("a", "x.pdf"), book("b", "x.epub", "epub")], [], "epub");

    expect(groups[0].members.map((m) => m.format)).toStrictEqual(["epub", "pdf"]);
  });

  it("lets the preferred format win over a book already on the shelf", () => {
    // The reader asked for EPUB: opening the entry fetches it from Dropbox
    // rather than quietly opening the PDF they said they did not prefer.
    const groups = groupShelf([book("a", "x.pdf")], [file("id:1", "x.epub")], "epub");

    expect(groups[0].members.map((m) => [m.kind, m.format])).toStrictEqual([
      ["dropbox", "epub"],
      ["book", "pdf"],
    ]);
  });

  it("puts the book on the shelf ahead of a Dropbox file of the same format", () => {
    const groups = groupShelf([book("a", "x.epub", "epub")], [file("id:1", "x.epub")], "epub");

    expect(groups[0].members.map((m) => m.kind)).toStrictEqual(["book", "dropbox"]);
  });

  it("prefers PDF when told nothing, even over an EPUB already on the shelf", () => {
    const groups = groupShelf([book("b", "x.epub", "epub")], [file("id:1", "x.pdf")]);

    expect(groups[0].members.map((m) => m.format)).toStrictEqual(["pdf", "epub"]);
  });

  it("ignores case and Unicode normalization when comparing names", () => {
    // が as one code point, and as か plus the combining mark.
    const groups = groupShelf([book("a", "が.PDF"), book("b", "が.epub", "epub")], []);

    expect(groups).toHaveLength(1);
  });

  it("keeps different names apart, in the order they first appeared", () => {
    const groups = groupShelf(
      [book("a", "one.pdf"), book("b", "two.pdf")],
      [file("id:1", "three.pdf")],
    );

    expect(groups.map((g) => g.title)).toStrictEqual(["one", "two", "three"]);
  });

  it("reads the format of a Dropbox file off its name", () => {
    const [group] = groupShelf([], [file("id:1", "x.EPUB"), file("id:2", "x.pdf")]);

    expect(group.members.map((m) => m.format)).toStrictEqual(["pdf", "epub"]);
  });
});

describe("splitHidden", () => {
  const groups = groupShelf(
    [book("a", "one.pdf"), book("b", "two.pdf"), book("c", "two.epub", "epub")],
    [],
  );

  it("shows everything when nothing is put away", () => {
    expect(splitHidden(groups, new Set()).hidden).toHaveLength(0);
  });

  it("puts away an entry only when every file in it is hidden", () => {
    const { shown, hidden } = splitHidden(groups, new Set(["a", "b"]));

    // "two" still has an EPUB the reader has not put away.
    expect(hidden.map((g) => g.title)).toStrictEqual(["one"]);
    expect(shown.map((g) => g.title)).toStrictEqual(["two"]);
  });

  it("puts away a whole entry once all its files are hidden", () => {
    const { shown, hidden } = splitHidden(groups, new Set(["b", "c"]));

    expect(hidden.map((g) => g.title)).toStrictEqual(["two"]);
    expect(shown.map((g) => g.title)).toStrictEqual(["one"]);
  });
});

describe("filterShelf", () => {
  const groups = groupShelf(
    [
      book("a", "Rust入門.pdf"),
      book("b", "Cloudflare Workers 入門.pdf"),
      book("c", "がくしゅう.epub", "epub"),
    ],
    [file("id:1", "TypeScript ハンドブック.pdf")],
  );
  const titles = (query: string) => filterShelf(groups, query).map((g) => g.title);

  it("keeps everything for an empty query, or one of spaces only", () => {
    expect(titles("")).toHaveLength(4);
    expect(titles("  ")).toHaveLength(4);
  });

  it("keeps the entries whose title holds the query anywhere", () => {
    expect(titles("入門")).toStrictEqual(["Rust入門", "Cloudflare Workers 入門"]);
    expect(titles("Workers")).toStrictEqual(["Cloudflare Workers 入門"]);
  });

  it("ignores case, the same way names are compared", () => {
    expect(titles("rust")).toStrictEqual(["Rust入門"]);
    expect(titles("TYPESCRIPT")).toStrictEqual(["TypeScript ハンドブック"]);
  });

  it("ignores Unicode normalization, the same way names are compared", () => {
    // が typed as か plus the combining mark finds the composed が, and back.
    expect(titles("\u304b\u3099く")).toStrictEqual(["がくしゅう"]);
    const decomposed = groupShelf([book("d", "\u304b\u3099くしゅう.pdf")], []);
    expect(filterShelf(decomposed, "がく")).toHaveLength(1);
  });

  it("matches the title, not the extension it was stored under", () => {
    expect(titles("pdf")).toStrictEqual([]);
  });

  it("keeps the order the shelf had", () => {
    expect(titles("入")).toStrictEqual(["Rust入門", "Cloudflare Workers 入門"]);
  });
});

describe("groupShelf with titles the reader gave", () => {
  const renamed = (
    id: string,
    fileName: string,
    title: string,
    format: "pdf" | "epub" = "pdf",
  ) => ({
    ...book(id, fileName, format),
    title,
  });

  it("calls an entry by the title the reader gave its book", () => {
    const [group] = groupShelf([renamed("a", "scan_0001.pdf", "Rust 入門")], []);

    expect(group.title).toBe("Rust 入門");
    expect(filterShelf([group], "rust")).toHaveLength(1);
    expect(filterShelf([group], "scan")).toHaveLength(0);
  });

  it("puts books the reader gave the same title into one entry, whatever their files are called", () => {
    const groups = groupShelf(
      [renamed("a", "scan_0001.pdf", "Rust 入門"), renamed("b", "rust.epub", "rust 入門", "epub")],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.key)).toStrictEqual(["a", "b"]);
  });

  it("keeps a Dropbox file with the renamed book its name still matches", () => {
    const groups = groupShelf(
      [renamed("a", "scan_0001.pdf", "Rust 入門")],
      [file("id:1", "scan_0001.epub")],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Rust 入門");
    expect(groups[0].members.map((m) => m.key)).toStrictEqual(["a", "id:1"]);
  });

  it("takes a book never renamed into the entry of a renamed one its file name matches", () => {
    // The EPUB brought in from Dropbox after the PDF was renamed: the same
    // book, though nobody has renamed this file of it yet.
    const groups = groupShelf(
      [book("b", "scan_0001.epub", "epub"), renamed("a", "scan_0001.pdf", "Rust 入門")],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Rust 入門");
  });

  it("keeps apart a book renamed away from the name it shared", () => {
    const groups = groupShelf(
      [renamed("a", "x.pdf", "別の本"), renamed("b", "x.epub", "もう一冊", "epub")],
      [],
    );

    expect(groups.map((g) => g.title)).toStrictEqual(["別の本", "もう一冊"]);
  });
});
