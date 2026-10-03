import { strToU8, zipSync, type Zippable } from "fflate";

/** One chapter of a test book: its file name under `OEBPS/` and its body markup. */
export interface FixtureChapter {
  file: string;
  body: string;
  /** Kept out of the reading order, as notes often are. */
  linear?: false;
}

export interface FixtureOptions {
  chapters: FixtureChapter[];
  /** The EPUB 3 navigation document's `<ol>` markup, hrefs relative to `OEBPS/`. */
  nav?: string;
  /** The EPUB 2 NCX `navMap` markup, used when no `nav` is given. */
  ncx?: string;
  /** Extra files under `OEBPS/`, listed in the manifest with the given media type. */
  resources?: { file: string; mediaType: string; bytes: Uint8Array; properties?: string }[];
}

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>t</title><style>body { color: red }</style></head>
<body>${body}</body>
</html>`;

/**
 * An EPUB built in memory, laid out the way publishers lay them out: the
 * package document under `OEBPS/`, chapters beside it.
 */
export function buildEpub({ chapters, nav, ncx, resources = [] }: FixtureOptions): Uint8Array {
  const manifest = [
    ...chapters.map(
      (chapter, i) =>
        `<item id="c${i}" href="${chapter.file}" media-type="application/xhtml+xml"/>`,
    ),
    ...(nav
      ? ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']
      : []),
    ...(ncx ? ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'] : []),
    ...resources.map(
      (resource, i) =>
        `<item id="r${i}" href="${resource.file}" media-type="${resource.mediaType}"${
          resource.properties ? ` properties="${resource.properties}"` : ""
        }/>`,
    ),
  ];
  const spine = chapters.map(
    (chapter, i) => `<itemref idref="c${i}"${chapter.linear === false ? ' linear="no"' : ""}/>`,
  );

  const files: Zippable = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>テストの本</dc:title></metadata>
  <manifest>${manifest.join("")}</manifest>
  <spine${ncx ? ' toc="ncx"' : ""}>${spine.join("")}</spine>
</package>`),
  };
  for (const chapter of chapters) files[`OEBPS/${chapter.file}`] = strToU8(xhtml(chapter.body));
  if (nav) {
    files["OEBPS/nav.xhtml"] = strToU8(xhtml(`<nav epub:type="toc">${nav}</nav>`));
  }
  if (ncx) {
    files["OEBPS/toc.ncx"] = strToU8(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${ncx}</navMap></ncx>`);
  }
  for (const resource of resources) files[`OEBPS/${resource.file}`] = resource.bytes;

  return zipSync(files);
}
