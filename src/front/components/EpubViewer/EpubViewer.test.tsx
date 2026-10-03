import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { okAsync } from "neverthrow";
import { EpubViewer } from "./EpubViewer";
import type { MeasureSelection } from "../PdfViewer/PdfViewer";
import { SwrTestCache } from "../../../test/swrTestCache";
import { buildEpub } from "../../../test/epubFixture";
import { bookKey } from "../../hooks/useBook";
import { currentPageAtom, outlineOpenAtom } from "../../atoms/pdfAtom";
import type { SaveSelection, SelectionDraft } from "../../hooks/useAskAboutSelection";
import type { BookDetail } from "../../../shared/schemas/book";

const BOOK: BookDetail = {
  id: "e1",
  fileName: "Workers.epub",
  format: "epub",
  pageCount: 2,
  hasThumbnail: false,
  hasOutline: true,
  selections: [],
  readingState: null,
};

const EPUB = buildEpub({
  chapters: [
    {
      file: "ch1.xhtml",
      body: '<h1>第1章</h1><p onclick="alert(1)">エッジで動く。</p><script>window.ran = true</script><a href="ch2.xhtml#end">続き</a>',
    },
    { file: "ch2.xhtml", body: '<h1>第2章</h1><p id="end">状態を持つ。</p>' },
  ],
  nav: '<ol><li><a href="ch1.xhtml">第1章</a></li><li><a href="ch2.xhtml">第2章</a></li></ol>',
});

/** Serves the stored EPUB, or refuses with the given status. */
function serving(status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      status === 200
        ? new Response(EPUB as BodyInit)
        : new Response(JSON.stringify({ error: { code: "PDF_FILE_MISSING", message: "gone" } }), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
    );
}

const MEASURED: ReturnType<MeasureSelection> = {
  position: { x: 0, y: 40, width: 120 },
  selectedText: "エッジで動く",
  selectionPosition: {
    startIndex: 3,
    endIndex: 9,
    pageNumber: 1,
    rects: [{ x: 0, y: 40, width: 120, height: 20 }],
    pageWidth: 600,
  },
};

function renderViewer(
  options: {
    store?: ReturnType<typeof createStore>;
    measureSelection?: MeasureSelection;
    saveSelection?: SaveSelection;
  } = {},
) {
  const store = options.store ?? createStore();
  render(
    <SwrTestCache seed={{ [bookKey(BOOK.id)]: BOOK }}>
      <Provider store={store}>
        <EpubViewer
          pdfId={BOOK.id}
          book={BOOK}
          bookError={undefined}
          onSelectionClick={() => {}}
          measureSelection={options.measureSelection}
          saveSelection={options.saveSelection}
        />
      </Provider>
    </SwrTestCache>,
  );
  return store;
}

describe("EpubViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws the chapter the reader is on, without anything of the book's that could run", async () => {
    vi.stubGlobal("fetch", serving());
    renderViewer();

    const heading = await screen.findByRole("heading", { name: "第1章" });
    const chapter = heading.parentElement!;
    expect(chapter).toHaveTextContent("エッジで動く。");
    expect(chapter.querySelector("script")).toBeNull();
    expect(chapter.querySelector("[onclick]")).toBeNull();
    expect((window as { ran?: boolean }).ran).toBeUndefined();
  });

  it("lists the book's own table of contents, and turns to the chapter an entry names", async () => {
    vi.stubGlobal("fetch", serving());
    const store = createStore();
    store.set(outlineOpenAtom, true);
    renderViewer({ store });

    const nav = await screen.findByRole("navigation", { name: "目次" });
    await userEvent.click(within(nav).getByRole("button", { name: /第2章/ }));

    expect(await screen.findByRole("heading", { name: "第2章" })).toBeInTheDocument();
    expect(store.get(currentPageAtom)).toBe(2);
  });

  it("follows a link into another chapter of the book", async () => {
    vi.stubGlobal("fetch", serving());
    const store = renderViewer();

    await userEvent.click(await screen.findByText("続き"));

    expect(await screen.findByRole("heading", { name: "第2章" })).toBeInTheDocument();
    expect(store.get(currentPageAtom)).toBe(2);
  });

  it("stores a highlight by where the passage sits in the chapter's text", async () => {
    vi.stubGlobal("fetch", serving());
    const saved: SelectionDraft[] = [];
    renderViewer({
      measureSelection: () => MEASURED,
      saveSelection: (_pdfId, draft) => {
        saved.push(draft);
        return okAsync({
          id: "s1",
          selectedText: draft.selectedText,
          pageNumber: draft.pageNumber,
          positionData: draft.positionData,
          createdAt: "2026-10-04T00:00:00.000Z",
        });
      },
    });
    await screen.findByRole("heading", { name: "第1章" });

    document.dispatchEvent(new Event("selectionchange"));
    const input = await screen.findByPlaceholderText("選択した文章について質問する...");
    await userEvent.type(input, "これは？{Enter}");

    expect(saved).toStrictEqual([
      {
        selectedText: "エッジで動く",
        pageNumber: 1,
        positionData: {
          rects: MEASURED.selectionPosition.rects,
          pageWidth: 600,
          textRange: { start: 3, end: 9 },
        },
      },
    ]);
  });

  it("says why the book could not be shown when its file is gone", async () => {
    vi.stubGlobal("fetch", serving(404));
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent("EPUBを表示できません: gone");
  });
});

function within(element: HTMLElement) {
  return {
    getByRole: (role: string, options: { name: RegExp }) =>
      screen.getAllByRole(role, options).find((found) => element.contains(found))!,
  };
}
