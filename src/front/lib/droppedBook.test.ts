import { describe, it, expect } from "vite-plus/test";
import { pickDroppedBook } from "./droppedBook";

const pdf = (name = "Cloudflare Workers.pdf", type = "application/pdf") =>
  new File(["%PDF-1.7"], name, { type });

describe("pickDroppedBook", () => {
  it("hands back the one PDF that was dropped", () => {
    const file = pdf();

    expect(pickDroppedBook([file])).toStrictEqual({ kind: "book", file });
  });

  it("takes a PDF the browser named no type for", () => {
    // Which is what a drop from some file managers looks like: the extension is
    // all there is to go on, and refusing it would refuse a real book.
    const file = pdf("Rust 入門.pdf", "");

    expect(pickDroppedBook([file])).toStrictEqual({ kind: "book", file });
  });

  it("hands back an EPUB, whether the browser typed it or only the name says so", () => {
    const typed = new File(["PK"], "小説.epub", { type: "application/epub+zip" });
    const untyped = new File(["PK"], "小説.EPUB", { type: "" });

    expect(pickDroppedBook([typed])).toStrictEqual({ kind: "book", file: typed });
    expect(pickDroppedBook([untyped])).toStrictEqual({ kind: "book", file: untyped });
  });

  it("refuses a drop of several files", () => {
    expect(pickDroppedBook([pdf("a.pdf"), pdf("b.pdf")])).toStrictEqual({
      kind: "refused",
      reason: "一度に追加できる本は1冊です",
    });
  });

  it("refuses a file that is neither a PDF nor an EPUB", () => {
    expect(pickDroppedBook([new File(["gif"], "cat.gif", { type: "image/gif" })])).toStrictEqual({
      kind: "refused",
      reason: "PDFかEPUBのファイルだけを追加できます",
    });
  });

  it("reports nothing to add when the drop carries no files", () => {
    // Dragging selected text over the shelf is a drop with nothing in it, and
    // has no business colouring the shelf red.
    expect(pickDroppedBook([])).toStrictEqual({ kind: "none" });
  });
});
