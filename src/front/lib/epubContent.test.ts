import { describe, it, expect } from "vite-plus/test";
import { chapterPlainText, renderChapter } from "./epubContent";

const CHAPTER = "OEBPS/text/ch1.xhtml";

const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

const render = (body: string, imageUrl: (path: string) => string | null = () => null) =>
  renderChapter(page(body), CHAPTER, { imageUrl });

describe("renderChapter", () => {
  it("keeps the text and structure of the chapter", () => {
    const out = render("<h1>見出し</h1><p>本文の<em>強調</em>です。</p>");

    expect(out.innerHTML).toBe("<h1>見出し</h1><p>本文の<em>強調</em>です。</p>");
  });

  it("drops scripts, styles, forms and embedded documents along with their content", () => {
    const out = render(
      '<p>残る</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><form><input/></form>',
    );

    expect(out.innerHTML).toBe("<p>残る</p>");
  });

  it("keeps none of the publisher's attributes that could run or restyle anything", () => {
    const out = render(
      '<p onclick="alert(1)" style="color:red" class="x" title="説明">文</p><a href="javascript:alert(1)">危</a>',
    );

    expect(out.innerHTML).toBe('<p title="説明">文</p><a>危</a>');
  });

  it("unwraps elements it does not know, keeping their text", () => {
    const out = render("<p><custom-tag>中身</custom-tag></p>");

    expect(out.innerHTML).toBe("<p>中身</p>");
  });

  it("prefixes ids so they cannot collide with the app's own", () => {
    expect(render('<h2 id="sec1">節</h2>').innerHTML).toBe('<h2 id="epub-sec1">節</h2>');
  });

  it("keeps where an in-book link leads for the viewer to follow, rather than an href", () => {
    const out = render('<a href="ch2.xhtml#s1">次</a><a href="#note">注</a>');

    expect(out.innerHTML).toBe(
      '<a data-epub-href="OEBPS/text/ch2.xhtml#s1">次</a>' +
        '<a data-epub-href="OEBPS/text/ch1.xhtml#note">注</a>',
    );
  });

  it("opens links out of the book in a tab of their own", () => {
    expect(render('<a href="https://example.com/">外</a>').innerHTML).toBe(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">外</a>',
    );
  });

  it("draws the book's images from the URL it is given, by archive path", () => {
    const asked: string[] = [];
    const out = render('<img src="../images/fig.png" alt="図1" onerror="x()"/>', (path) => {
      asked.push(path);
      return "blob:fig";
    });

    expect(asked).toStrictEqual(["OEBPS/images/fig.png"]);
    expect(out.innerHTML).toBe('<img src="blob:fig" alt="図1">');
  });

  it("keeps an image's alternative text when the image cannot be drawn", () => {
    expect(render('<p><img src="gone.png" alt="図2"/></p>').innerHTML).toBe("<p>図2</p>");
  });

  it("keeps an image of the book that is drawn as an SVG, and nothing else of the SVG", () => {
    const out = render(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script>x()</script><image xlink:href="cover.jpg"/></svg>',
      () => "blob:cover",
    );

    expect(out.innerHTML).toBe('<img src="blob:cover">');
  });

  it("reads a chapter that is not well-formed XML as HTML", () => {
    const out = renderChapter("<html><body><p>閉じていない<br></p></body></html>", CHAPTER, {
      imageUrl: () => null,
    });

    expect(out.textContent).toBe("閉じていない");
  });
});

describe("chapterPlainText", () => {
  it("puts each block on a line of its own, even with no whitespace between them", () => {
    const out = render("<h1>見出し</h1><p>一段落目。</p><ul><li>項目</li></ul>");

    expect(chapterPlainText(out)).toBe("見出し\n一段落目。\n項目");
  });
});
