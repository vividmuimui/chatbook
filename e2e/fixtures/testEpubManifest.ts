/**
 * What `test-epub.epub` holds, read by both the generator and the specs so
 * neither writes the numbers down a second time.
 *
 * Each chapter is one item of the spine, which the reader counts as a page.
 */
export const EPUB_FILE_NAME = "test-epub.epub";

/** What the shelf calls the book: its file name without the extension. */
export const EPUB_TITLE = "test-epub";

/**
 * Paragraphs that only take up room: enough of them that the chapter fills
 * several screens of even the widest pane the tests read it in, so turning a
 * screen has somewhere to go before the next chapter. They say nothing any test
 * searches for.
 */
function filler(chapter: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `${chapter}の${i + 1}段落目は、画面ごとにめくって読むことを確かめるために置いた文で、本文の筋には関わりません。`,
  );
}

/** How many filler paragraphs the long chapters hold. */
export const FILLER_PARAGRAPHS = 30;

/**
 * A section of a chapter: an `<h2>` with an id, which the table of contents
 * points at as `ch3.xhtml#<id>`. Several of them in one file is how the books
 * the reader was first given lay a chapter out — one item of the spine, many
 * entries of the contents — and the reader has to tell them apart by anchor.
 */
export interface EpubFixtureSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface EpubFixtureChapter {
  file: string;
  heading: string;
  paragraphs: string[];
  /** After the chapter's own paragraphs, each listed under the chapter in the contents. */
  sections?: EpubFixtureSection[];
}

export const EPUB_CHAPTERS: EpubFixtureChapter[] = [
  {
    file: "ch1.xhtml",
    heading: "第1章 エッジで動かす",
    paragraphs: [
      "Workers はリクエストを受けた場所の近くで動くサーバーレス実行基盤です。",
      "起動にかかる時間は短く、コールドスタートを意識せずに書けます。",
    ],
  },
  {
    file: "ch2.xhtml",
    heading: "第2章 状態を持つ",
    paragraphs: [
      "Durable Objects は一意な名前で呼び出せる、状態を持つオブジェクトです。",
      "同じ名前への呼び出しは一つの場所に集まるので、整合性を保ちやすくなります。",
      ...filler("第2章", FILLER_PARAGRAPHS),
    ],
  },
  {
    file: "ch3.xhtml",
    heading: "第3章 保存する",
    paragraphs: ["データの置き場所は、大きさと問い合わせ方で選びます。"],
    // Two sections in the one file, the second screens into it: the contents
    // have to reach it by its anchor, since its chapter alone opens at the top
    sections: [
      {
        id: "s3-1",
        heading: "3.1 データベースに問い合わせる",
        paragraphs: [
          "D1 は SQLite をもとにしたデータベースで、Workers から直接問い合わせられます。",
          // Between the two, so the passage chapter 1 links to is screens into the chapter
          ...filler("第3章", FILLER_PARAGRAPHS),
        ],
      },
      {
        id: "s3-2",
        heading: "3.2 大きなファイルを置く",
        paragraphs: ["R2 は大きなファイルを置くためのオブジェクトストレージです。"],
      },
    ],
  },
];

/** Every paragraph of a chapter, its sections' included, in reading order. */
export function chapterParagraphs(chapter: EpubFixtureChapter): string[] {
  return [
    ...chapter.paragraphs,
    ...(chapter.sections ?? []).flatMap((section) => section.paragraphs),
  ];
}

/** The passage chapter 1 links to in chapter 3 — its last paragraph — by its id there. */
export const LINKED_ANCHOR = "r2";
