import { strFromU8, unzipSync } from "fflate";
import type { OutlineEntry } from "./pdfOutline";

/**
 * One chapter of an EPUB: one item of its spine, which is what this app counts
 * as a page of the book (see `bookFormatSchema`).
 */
export interface EpubChapter {
  /** Where the chapter sits in the archive, e.g. `OEBPS/text/ch01.xhtml`. */
  path: string;
  /** The chapter's XHTML as the publisher wrote it. Never drawn as it is: see `epubContent.ts`. */
  source: string;
}

/** An EPUB opened in memory, with what the reader and the upload need of it. */
export interface EpubBook {
  title: string | null;
  /** In reading order. Never empty: a book with nothing to read is refused. */
  chapters: EpubChapter[];
  /** The table of contents, each entry resolved to the chapter it opens. */
  outline: OutlineEntry[];
  /** The archive path of the cover image, when the book names one. */
  coverPath: string | null;
  /** The bytes of a file in the archive, by its full path. */
  file(path: string): Uint8Array | null;
  /** The media type the book's manifest gives a file, by its full path. */
  mediaType(path: string): string | null;
}

/** Why an EPUB could not be opened, in words the shelf can put in front of the reader. */
export class EpubError extends Error {
  override name = "EpubError";
}

/** The directory part of an archive path, with its trailing slash. */
function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** Whether a reference points outside the book (`https:`, `mailto:` …). */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/**
 * The archive path a reference made from `fromPath` points at, without its
 * fragment.
 *
 * References in an EPUB are relative URLs: relative to the file they are
 * written in, percent-encoded, and free to climb with `..`.
 */
export function resolveArchivePath(fromPath: string, href: string): string {
  const [withoutFragment] = href.split("#");
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // A stray `%` is not an encoding, just a character of the name
  }

  const joined = decoded.startsWith("/") ? decoded.slice(1) : directoryOf(fromPath) + decoded;
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** The fragment of a reference, if it has one. */
export function fragmentOf(href: string): string | null {
  const hash = href.indexOf("#");
  if (hash < 0 || hash === href.length - 1) return null;
  const fragment = href.slice(hash + 1);
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** Elements by local name, whatever namespace (or none) the document put them in. */
function elementsNamed(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

/** The element's own children with the given local name. */
function childrenNamed(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function parseXml(source: string, path: string): Document {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new EpubError(`${path} を読み取れませんでした`);
  }
  return doc;
}

/**
 * A chapter or navigation document, read as XHTML when it is well-formed and as
 * HTML when it is not — publishers ship both, and a browser would show either.
 */
export function parseXhtml(source: string): Document {
  const strict = new DOMParser().parseFromString(source, "application/xhtml+xml");
  if (strict.getElementsByTagName("parsererror").length === 0) return strict;
  return new DOMParser().parseFromString(source, "text/html");
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

const CHAPTER_TYPES = new Set(["application/xhtml+xml", "text/html"]);

/** The `epub:type` of an element, however the parser kept the prefix. */
function epubType(element: Element): string {
  return (
    element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
    element.getAttribute("epub:type") ??
    ""
  );
}

/**
 * The place in its chapter a table of contents entry points at, as the entry
 * carries it: nothing for an entry that opens its chapter at the top.
 *
 * Kept rather than dropped with the rest of the reference: a book that writes a
 * whole chapter — 7.1 to 7.5 — into one file of its spine points every section
 * at the same file, and the fragment is the only thing that tells them apart.
 */
function anchorOf(href: string | null): { anchor?: string } {
  const anchor = href ? fragmentOf(href) : null;
  return anchor ? { anchor } : {};
}

/** EPUB 3: the `<nav epub:type="toc">` of the navigation document. */
function readNavDocument(
  source: string,
  navPath: string,
  pageOf: (path: string) => number | null,
): OutlineEntry[] {
  const doc = parseXhtml(source);
  const navs = elementsNamed(doc, "nav");
  const toc = navs.find((nav) => epubType(nav).split(/\s+/).includes("toc")) ?? navs[0];
  const list = toc ? elementsNamed(toc, "ol")[0] : undefined;
  if (!list) return [];

  const readList = (ol: Element): OutlineEntry[] =>
    childrenNamed(ol, "li").map((li) => {
      const label = childrenNamed(li, "a")[0] ?? childrenNamed(li, "span")[0];
      const href = label?.localName === "a" ? label.getAttribute("href") : null;
      const nested = childrenNamed(li, "ol")[0];
      const internal = href && !isExternalHref(href) ? href : null;
      return {
        title: (label?.textContent ?? "").replace(/\s+/g, " ").trim(),
        pageNumber: internal ? pageOf(resolveArchivePath(navPath, internal)) : null,
        children: nested ? readList(nested) : [],
        ...anchorOf(internal),
      };
    });

  return readList(list);
}

/** EPUB 2: the `navMap` of the NCX file. */
function readNcx(
  source: string,
  ncxPath: string,
  pageOf: (path: string) => number | null,
): OutlineEntry[] {
  const doc = parseXml(source, ncxPath);
  const navMap = elementsNamed(doc, "navMap")[0];
  if (!navMap) return [];

  const readPoints = (parent: Element): OutlineEntry[] =>
    childrenNamed(parent, "navPoint").map((point) => {
      const label = childrenNamed(point, "navLabel")[0];
      const src = childrenNamed(point, "content")[0]?.getAttribute("src");
      const internal = src && !isExternalHref(src) ? src : null;
      return {
        title: (label?.textContent ?? "").replace(/\s+/g, " ").trim(),
        pageNumber: internal ? pageOf(resolveArchivePath(ncxPath, internal)) : null,
        children: readPoints(point),
        ...anchorOf(internal),
      };
    });

  return readPoints(navMap);
}

/**
 * Open an EPUB: unpack it, and read its package document for the chapters in
 * reading order, the table of contents and the cover.
 *
 * Throws `EpubError` for an archive that is not an EPUB the reader could read.
 * A table of contents that cannot be read is not one of those — the book is
 * still readable chapter by chapter, so it comes back without an outline.
 */
export function openEpub(bytes: Uint8Array): EpubBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new EpubError("EPUBファイルを展開できませんでした");
  }

  const text = (path: string) => {
    const data = files[path];
    if (!data) throw new EpubError(`${path} がEPUBの中にありません`);
    return strFromU8(data);
  };

  const container = parseXml(text("META-INF/container.xml"), "META-INF/container.xml");
  const opfPath = elementsNamed(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new EpubError("EPUBのパッケージ文書が見つかりません");

  const opf = parseXml(text(opfPath), opfPath);
  const manifest = new Map<string, ManifestItem>();
  const mediaTypes = new Map<string, string>();
  for (const item of elementsNamed(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    const entry: ManifestItem = {
      id,
      path: resolveArchivePath(opfPath, href),
      mediaType: item.getAttribute("media-type") ?? "",
      properties: (item.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean),
    };
    manifest.set(id, entry);
    mediaTypes.set(entry.path, entry.mediaType);
  }

  const spine = elementsNamed(opf, "spine")[0];
  const chapters: EpubChapter[] = [];
  for (const itemref of spine ? elementsNamed(spine, "itemref") : []) {
    // Notes and the like that the publisher kept out of the reading order
    if (itemref.getAttribute("linear") === "no") continue;
    const item = manifest.get(itemref.getAttribute("idref") ?? "");
    if (!item || !CHAPTER_TYPES.has(item.mediaType) || !files[item.path]) continue;
    chapters.push({ path: item.path, source: strFromU8(files[item.path]) });
  }
  if (chapters.length === 0) throw new EpubError("EPUBに読める章がありません");

  const pageByPath = new Map(chapters.map((chapter, i) => [chapter.path, i + 1]));
  const pageOf = (path: string) => pageByPath.get(path) ?? null;

  let outline: OutlineEntry[] = [];
  try {
    const nav = [...manifest.values()].find((item) => item.properties.includes("nav"));
    const ncx = manifest.get(spine?.getAttribute("toc") ?? "");
    if (nav && files[nav.path]) outline = readNavDocument(text(nav.path), nav.path, pageOf);
    else if (ncx && files[ncx.path]) outline = readNcx(text(ncx.path), ncx.path, pageOf);
  } catch {
    // A table of contents that does not parse leaves the book without one: the
    // chapters are still all there to be read, and the outline panel says the
    // book has none rather than refusing to open it.
    outline = [];
  }

  const coverId = elementsNamed(opf, "meta")
    .find((meta) => meta.getAttribute("name") === "cover")
    ?.getAttribute("content");
  const cover =
    [...manifest.values()].find((item) => item.properties.includes("cover-image")) ??
    (coverId ? manifest.get(coverId) : undefined);

  return {
    title: elementsNamed(opf, "title")[0]?.textContent?.trim() || null,
    chapters,
    outline,
    coverPath:
      cover && cover.mediaType.startsWith("image/") && files[cover.path] ? cover.path : null,
    file: (path) => files[path] ?? null,
    mediaType: (path) => mediaTypes.get(path) ?? null,
  };
}
