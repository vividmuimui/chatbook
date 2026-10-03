import { fragmentOf, isExternalHref, parseXhtml, resolveArchivePath } from "./epub";

/**
 * Elements that are dropped together with everything inside them.
 *
 * Scripts and anything that can run or load something, forms that could post
 * the reader's input somewhere, and the publisher's own styling — the reader
 * draws chapters in its own type so that every book reads the same way and none
 * of them can restyle the app around it.
 */
const DROPPED = new Set([
  "script",
  "style",
  "link",
  "meta",
  "title",
  "head",
  "base",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "noscript",
  "template",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
]);

/** Elements kept as themselves. Anything not here and not dropped is unwrapped: its text stays. */
const KEPT = new Set([
  "p",
  "div",
  "span",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "br",
  "hr",
  "wbr",
  "cite",
  "q",
  "abbr",
  "dfn",
  "time",
  "ruby",
  "rt",
  "rp",
  "figure",
  "figcaption",
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

/** Attributes copied as they are, on any kept element. */
const PLAIN_ATTRIBUTES = ["title", "lang", "dir", "alt", "colspan", "rowspan", "start", "type"];

/**
 * What a chapter's ids become in the reader. Prefixed because the chapter is
 * drawn inside the app's own document, where a book's `id="root"` would
 * otherwise collide with the app's.
 */
export const EPUB_ID_PREFIX = "epub-";

/** Where an in-book link leads, kept on the link instead of an `href` the browser would follow. */
export const EPUB_HREF_ATTR = "data-epub-href";

export interface ChapterRendering {
  /**
   * The URL to draw an image of the book from, by its archive path, or null to
   * leave the image out (its alternative text stays).
   */
  imageUrl: (path: string) => string | null;
}

const XLINK = "http://www.w3.org/1999/xlink";

/**
 * A chapter made safe to put in the app's own document.
 *
 * Built afresh rather than filtered: every element and attribute in the result
 * was created here from an allowlist, so nothing the publisher wrote — an event
 * handler, a `javascript:` link, a stylesheet — can come along by being
 * overlooked. Links into the book keep their target in `data-epub-href` for the
 * viewer to follow; links out of it open in a new tab.
 */
export function renderChapter(
  source: string,
  chapterPath: string,
  { imageUrl }: ChapterRendering,
): HTMLElement {
  const doc = parseXhtml(source);
  const body = doc.getElementsByTagNameNS("*", "body")[0] ?? doc.documentElement;
  const out = document.createElement("div");

  const image = (rawSrc: string | null, alt: string | null): Node | null => {
    const url =
      rawSrc && !isExternalHref(rawSrc) ? imageUrl(resolveArchivePath(chapterPath, rawSrc)) : null;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      if (alt) img.alt = alt;
      return img;
    }
    return alt ? document.createTextNode(alt) : null;
  };

  const copyChildren = (from: Node, into: Node) => {
    for (const child of Array.from(from.childNodes)) {
      const copied = copy(child);
      for (const node of copied) into.appendChild(node);
    }
  };

  const copy = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      return [document.createTextNode(node.nodeValue ?? "")];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const source = node as Element;
    const name = source.localName.toLowerCase();
    if (DROPPED.has(name)) return [];

    // A cover or a figure drawn as an SVG <image> — the one thing in an SVG
    // worth keeping, and an <img> can carry it without any of SVG's scripting.
    if (name === "svg") {
      return Array.from(source.getElementsByTagNameNS("*", "image"))
        .map((img) => image(img.getAttributeNS(XLINK, "href") ?? img.getAttribute("href"), null))
        .filter((made): made is Node => made !== null);
    }

    if (name === "img") {
      const made = image(source.getAttribute("src"), source.getAttribute("alt"));
      return made ? [made] : [];
    }

    if (!KEPT.has(name)) {
      const fragment = document.createDocumentFragment();
      copyChildren(source, fragment);
      return [fragment];
    }

    const element = document.createElement(name);
    for (const attribute of PLAIN_ATTRIBUTES) {
      const value = source.getAttribute(attribute);
      if (value !== null) element.setAttribute(attribute, value);
    }
    const lang = source.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang");
    if (lang && !element.hasAttribute("lang")) element.setAttribute("lang", lang);
    const id = source.getAttribute("id");
    if (id) element.id = `${EPUB_ID_PREFIX}${id}`;

    if (name === "a") {
      const href = source.getAttribute("href");
      if (href && /^(https?|mailto):/i.test(href)) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } else if (href && !isExternalHref(href)) {
        const fragment = fragmentOf(href);
        const target = href.startsWith("#") ? chapterPath : resolveArchivePath(chapterPath, href);
        element.setAttribute(EPUB_HREF_ATTR, fragment ? `${target}#${fragment}` : target);
      }
    }

    copyChildren(source, element);
    return [element];
  };

  copyChildren(body, out);
  return out;
}

/** Elements that end a line of the text sent to chat. */
const BLOCKS = new Set([
  "p",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "table",
  "caption",
  "tr",
  "br",
  "hr",
]);

/**
 * A rendered chapter's text as chat is given it: paragraphs on lines of their
 * own, since `textContent` runs a heading straight into the paragraph after it
 * when the publisher wrote no whitespace between the two.
 */
export function chapterPlainText(chapter: HTMLElement): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? "";
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
    if (node.nodeType === Node.ELEMENT_NODE && BLOCKS.has((node as Element).localName)) {
      text += "\n";
    }
  };
  walk(chapter);
  return text
    .replace(/[ \t\r]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
