import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { okAsync } from "neverthrow";
import { EpubViewer } from "./EpubViewer";
import type { MeasureSelection } from "../PdfViewer/PdfViewer";
import { SwrTestCache } from "../../../test/swrTestCache";
import { buildEpub } from "../../../test/epubFixture";
import { bookKey } from "../../hooks/useBook";
import { currentPageAtom, outlineOpenAtom } from "../../atoms/pdfAtom";
import { epubTypographyAtom } from "../../atoms/settingsAtom";
import { DEFAULT_EPUB_TYPOGRAPHY } from "../../lib/epubTypography";
import type { SaveSelection, SelectionDraft } from "../../hooks/useAskAboutSelection";
import type { BookDetail } from "../../../shared/schemas/book";

const BOOK: BookDetail = {
  title: null,
  id: "e1",
  fileName: "Workers.epub",
  format: "epub",
  pageCount: 2,
  hasThumbnail: false,
  hasOutline: true,
  pageDirection: "ltr",
  hasOcr: false,
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
    book?: BookDetail;
  } = {},
) {
  const store = options.store ?? createStore();
  const book = options.book ?? BOOK;
  render(
    <SwrTestCache seed={{ [bookKey(book.id)]: book }}>
      <Provider store={store}>
        <EpubViewer
          pdfId={book.id}
          book={book}
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
    vi.restoreAllMocks();
    localStorage.clear();
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

  // jsdom lays nothing out, so every chapter here fills the one screen: a turn
  // on from it is a turn from the chapter's last screen.
  it("turns on from the last screen of a chapter into the next with →, and back into its end with ←", async () => {
    vi.stubGlobal("fetch", serving());
    const store = renderViewer();
    await screen.findByRole("heading", { name: "第1章" });

    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("heading", { name: "第2章" })).toBeInTheDocument();
    expect(store.get(currentPageAtom)).toBe(2);
    expect(screen.getByText("2 / 2 章", { exact: true })).toBeInTheDocument();

    await userEvent.keyboard("{ArrowLeft}");
    expect(await screen.findByRole("heading", { name: "第1章" })).toBeInTheDocument();
    expect(store.get(currentPageAtom)).toBe(1);
  });

  // A screen read a screen at a time has nothing in it to scroll
  it("turns with ↓ and ↑ as well", async () => {
    vi.stubGlobal("fetch", serving());
    const store = renderViewer();
    await screen.findByRole("heading", { name: "第1章" });

    await userEvent.keyboard("{ArrowDown}");
    expect(await screen.findByRole("heading", { name: "第2章" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowUp}");
    expect(await screen.findByRole("heading", { name: "第1章" })).toBeInTheDocument();
    expect(store.get(currentPageAtom)).toBe(1);
  });

  it("turns on at a tap on the right edge of the screen, and leaves the middle alone", async () => {
    vi.stubGlobal("fetch", serving());
    const store = renderViewer();
    const heading = await screen.findByRole("heading", { name: "第1章" });
    const paper = heading.closest("article")!;
    vi.spyOn(paper, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 600));

    fireEvent.pointerDown(heading, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(heading, { clientX: 200, clientY: 100 });
    expect(store.get(currentPageAtom)).toBe(1);

    fireEvent.pointerDown(heading, { clientX: 380, clientY: 100 });
    fireEvent.pointerUp(heading, { clientX: 380, clientY: 100 });
    expect(await screen.findByRole("heading", { name: "第2章" })).toBeInTheDocument();
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
          color: "#FFEB3B",
          note: null,
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

  it("draws the chapter in the type the reader chose, and redraws it as they change it", async () => {
    vi.stubGlobal("fetch", serving());
    const store = createStore();
    store.set(epubTypographyAtom, { ...DEFAULT_EPUB_TYPOGRAPHY, fontSizeStep: 9 });
    renderViewer({ store });

    const heading = await screen.findByRole("heading", { name: "第1章" });
    const page = heading.closest("article")!;
    expect(page.style.getPropertyValue("--epub-font-size")).toBe("32px");

    act(() => {
      store.set(epubTypographyAtom, { ...DEFAULT_EPUB_TYPOGRAPHY, textAlign: "justify" });
    });
    expect(page.style.getPropertyValue("--epub-font-size")).toBe("17px");
    expect(page.style.getPropertyValue("--epub-text-align")).toBe("justify");
  });

  // Justifying the text moves the words along their lines without changing the
  // size of the box they are in, so the chapter's ResizeObserver never hears of
  // it: the setting itself has to be what sends the highlights to be measured.
  it("measures its highlights again when the reader changes the type, even where the box keeps its size", async () => {
    vi.stubGlobal("fetch", serving());
    let lineTop = 40;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      () => [new DOMRect(10, lineTop, 100, 20)] as unknown as DOMRectList,
    );
    const store = createStore();
    renderViewer({
      store,
      book: {
        ...BOOK,
        selections: [
          {
            id: "s1",
            selectedText: "エッジで動く",
            pageNumber: 1,
            positionData: { rects: [], textRange: { start: 3, end: 9 } },
            color: "#FFEB3B",
            note: null,
            createdAt: "2026-10-04T00:00:00.000Z",
          },
        ],
      },
    });

    const highlight = await screen.findByRole("button", { name: "ハイライトのチャットを開く" });
    expect(highlight.style.top).toBe("40px");

    lineTop = 64;
    act(() => {
      store.set(epubTypographyAtom, { ...DEFAULT_EPUB_TYPOGRAPHY, textAlign: "justify" });
    });

    expect(screen.getByRole("button", { name: "ハイライトのチャットを開く" }).style.top).toBe(
      "64px",
    );
  });

  it("keeps a passage marked in a colour by its place in the chapter's text, with its note", async () => {
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
          color: "#42A5F5",
          note: "要確認",
          createdAt: "2026-10-04T00:00:00.000Z",
        });
      },
    });
    await screen.findByRole("heading", { name: "第1章" });

    document.dispatchEvent(new Event("selectionchange"));
    await userEvent.click(await screen.findByRole("button", { name: "メモを書く" }));
    await userEvent.click(screen.getByRole("button", { name: "青を選ぶ" }));
    await userEvent.type(
      screen.getByPlaceholderText("選択した文章にメモを書く..."),
      "要確認{Enter}",
    );

    expect(saved).toStrictEqual([
      {
        selectedText: "エッジで動く",
        pageNumber: 1,
        positionData: {
          rects: MEASURED.selectionPosition.rects,
          pageWidth: 600,
          textRange: { start: 3, end: 9 },
        },
        color: "#42A5F5",
        note: "要確認",
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("選択した文章にメモを書く...")).toBeNull(),
    );
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
