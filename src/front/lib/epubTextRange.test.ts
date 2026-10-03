import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import {
  rangeOfQuote,
  rangeOfTextOffsets,
  screenOfTextOffset,
  textOffsetOfScreen,
  textOffsetsOf,
} from "./epubTextRange";

/** A drawn chapter holding the given markup, attached so ranges can span it. */
function chapter(markup: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const root = document.createElement("div");
  root.append(...Array.from(parsed.body.childNodes));
  document.body.appendChild(root);
  return root;
}

describe("textOffsetsOf / rangeOfTextOffsets", () => {
  it("finds a passage that spans elements by where it is in the chapter's text", () => {
    const root = chapter("<h1>見出し</h1><p>本文の<em>強調</em>です。</p>");
    const em = root.querySelector("em")!.firstChild!;
    const range = document.createRange();
    range.setStart(root.querySelector("p")!.firstChild!, 1);
    range.setEnd(em, 2);

    const offsets = textOffsetsOf(root, range);
    expect(offsets).toStrictEqual({ start: 4, end: 8 });
    expect(rangeOfTextOffsets(root, offsets!)?.toString()).toBe("文の強調");
  });

  it("cuts a range that runs past the end of the chapter to the chapter", () => {
    const root = chapter("<p>章の終わり</p>");
    const after = chapter("<p>次の要素</p>");
    const range = document.createRange();
    range.setStart(root.querySelector("p")!.firstChild!, 2);
    range.setEnd(after.querySelector("p")!.firstChild!, 2);

    expect(textOffsetsOf(root, range)).toStrictEqual({ start: 2, end: 5 });
  });

  it("says a range outside the chapter covers nothing in it", () => {
    const root = chapter("<p>この章</p>");
    const other = chapter("<p>別の章</p>");
    const range = document.createRange();
    range.selectNodeContents(other);

    expect(textOffsetsOf(root, range)).toBeNull();
  });

  it("draws nothing for offsets past the end of the chapter's text", () => {
    const root = chapter("<p>短い</p>");

    expect(rangeOfTextOffsets(root, { start: 1, end: 10 })).toBeNull();
  });

  it("ends a passage at the very end of a text node", () => {
    const root = chapter("<p>前</p><p>後ろ</p>");

    expect(rangeOfTextOffsets(root, { start: 0, end: 1 })?.toString()).toBe("前");
    expect(rangeOfTextOffsets(root, { start: 1, end: 3 })?.toString()).toBe("後ろ");
  });
});

describe("rangeOfQuote", () => {
  it("finds a quote however the chapter breaks it up and spaces it", () => {
    const root = chapter("<p>Workers は<strong>エッジ</strong>で\n  動く。</p>");

    expect(rangeOfQuote(root, "Workersはエッジで動く")?.toString()).toBe(
      "Workers はエッジで\n  動く",
    );
  });

  it("finds the occurrence the text around it names, as a search hit carries", () => {
    const root = chapter("<p>エッジで動く。</p><p>次もエッジで動く。</p>");

    const range = rangeOfQuote(root, "エッジ", { before: "次も", after: "で動く" });

    expect(range?.startContainer.parentElement?.textContent).toBe("次もエッジで動く。");
    expect(range?.toString()).toBe("エッジ");
  });

  it("finds nothing for a quote the chapter does not hold", () => {
    expect(rangeOfQuote(chapter("<p>本文</p>"), "どこにもない文")).toBeNull();
  });
});

describe("textOffsetOfScreen / screenOfTextOffset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Lays the chapter out as columns 400px apart: each character is drawn in
   * the column its letter names (a → the first, b → the second, …), and white
   * space between blocks is not drawn at all.
   */
  function laidOutInColumns() {
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const char = this.toString();
      if (char.trim() === "") return [] as unknown as DOMRectList;
      const column = char.charCodeAt(0) - "a".charCodeAt(0);
      return [new DOMRect(20 + column * 400, 10, 8, 20)] as unknown as DOMRectList;
    });
  }

  it("finds where in the chapter's text a screen starts", () => {
    laidOutInColumns();
    const root = chapter("<p>aaa</p>\n<p>abb</p>\n<p>bcc</p>");

    expect(textOffsetOfScreen(root, root, 400, 0)).toBe(0);
    // "aaa" + "\n" + "a" before the first b
    expect(textOffsetOfScreen(root, root, 400, 1)).toBe(5);
    expect(textOffsetOfScreen(root, root, 400, 2)).toBe(9);
  });

  it("finds the screen a place in the chapter's text is drawn on", () => {
    laidOutInColumns();
    const root = chapter("<p>aaa</p>\n<p>abb</p>\n<p>bcc</p>");

    expect(screenOfTextOffset(root, root, 400, 0)).toBe(0);
    expect(screenOfTextOffset(root, root, 400, 5)).toBe(1);
    // The white space between two paragraphs is where the next one starts
    expect(screenOfTextOffset(root, root, 400, 3)).toBe(0);
    expect(screenOfTextOffset(root, root, 400, 7)).toBe(1);
    expect(screenOfTextOffset(root, root, 400, 10)).toBe(2);
  });

  it("knows of no screen past the end of the chapter's text", () => {
    laidOutInColumns();
    const root = chapter("<p>aa</p>");

    expect(textOffsetOfScreen(root, root, 400, 3)).toBeNull();
    expect(screenOfTextOffset(root, root, 400, 10)).toBeNull();
  });
});
