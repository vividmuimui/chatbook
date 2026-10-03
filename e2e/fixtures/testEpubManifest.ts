/**
 * What `test-epub.epub` holds, read by both the generator and the specs so
 * neither writes the numbers down a second time.
 *
 * Each chapter is one item of the spine, which the reader counts as a page.
 */
export const EPUB_FILE_NAME = "test-epub.epub";

/** What the shelf calls the book: its file name without the extension. */
export const EPUB_TITLE = "test-epub";

export interface EpubFixtureChapter {
  file: string;
  heading: string;
  paragraphs: string[];
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
    ],
  },
  {
    file: "ch3.xhtml",
    heading: "第3章 保存する",
    paragraphs: [
      "D1 は SQLite をもとにしたデータベースで、Workers から直接問い合わせられます。",
      "R2 は大きなファイルを置くためのオブジェクトストレージです。",
    ],
  },
];

/** The passage chapter 1 links to in chapter 3, by its id there. */
export const LINKED_ANCHOR = "r2";
