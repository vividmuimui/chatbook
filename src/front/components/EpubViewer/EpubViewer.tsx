// oxlint-disable-next-line no-restricted-imports -- 無害化した章の DOM への差し込みとスクロール位置の設定、ResizeObserver の購読、描かれた章からのハイライトと引用箇所の計測に必要
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { citedPassageAtom, currentPageAtom, outlineOpenAtom } from "../../atoms/pdfAtom";
import { activeSelectionAtom, type ActiveSelection } from "../../atoms/chatAtom";
import { useWebSearchAtom } from "../../atoms/settingsAtom";
import type { BookDetail } from "../../../shared/schemas/book";
import type { PositionData } from "../../../shared/schemas/selection";
import { PdfOutline } from "../PdfViewer/PdfOutline";
import { PageStepper } from "../PdfViewer/PageStepper";
import { SelectionPopover } from "../PdfViewer/SelectionPopover";
import { SelectionActionBar } from "../PdfViewer/SelectionActionBar";
import { HighlightOverlay } from "../PdfViewer/HighlightOverlay";
import type { MeasureSelection, SelectionPopoverState } from "../PdfViewer/PdfViewer";
import { useEpubDocument } from "../../hooks/useEpubDocument";
import { useAskAboutSelection, type SaveSelection } from "../../hooks/useAskAboutSelection";
import { useHighlights } from "../../hooks/useHighlights";
import { useIsNarrow } from "../../hooks/useIsNarrow";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useSettledSelection } from "../../hooks/useSettledSelection";
import { selectionOnPage, type PageSelection } from "../../lib/selectionRects";
import { EPUB_HREF_ATTR, EPUB_ID_PREFIX, renderChapter } from "../../lib/epubContent";
import { rangeOfQuote, rangeOfTextOffsets, textOffsetsOf } from "../../lib/epubTextRange";
import type { ViewerAction } from "../../lib/keybindings";

interface EpubViewerProps {
  /** The book being read, from the address the reader followed. */
  pdfId: string | undefined;
  /** The book being read, or nothing while it is still being read in. */
  book: BookDetail | undefined;
  /** Why the book could not be read, if it could not. */
  bookError: Error | undefined;
  onSelectionClick: (selection: ActiveSelection) => void;
  /** Measures the passage the reader has chosen; injectable for the same reason as `PdfViewer`'s. */
  measureSelection?: MeasureSelection;
  /** Stores the highlight; injectable so a failed save can be tested. */
  saveSelection?: SaveSelection;
}

/** Marks the box a chapter and the overlays laid over it share, as `PdfViewer` marks a page. */
const PAGE_CONTAINER_ATTR = "data-page-container";

/** Marks the element the chapter's own text is drawn into, which offsets are counted in. */
const CHAPTER_CONTENT_ATTR = "data-epub-chapter";

/** How far j/k move the chapter, in pixels, as they move a PDF page. */
const SCROLL_STEP = 80;

function pageContainerOf(node: Node | null | undefined): HTMLDivElement | null {
  const from = node instanceof Element ? node : node?.parentElement;
  return from?.closest<HTMLDivElement>(`[${PAGE_CONTAINER_ATTR}]`) ?? null;
}

/** The chapter element the current selection was started in, if it was started in one. */
function selectedPageElement(): HTMLDivElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  return pageContainerOf(selection.anchorNode ?? selection.getRangeAt(0).startContainer);
}

/**
 * Read the current selection and place it in the chapter.
 *
 * What is kept is where the passage sits in the chapter's text: the chapter
 * reflows with the pane, so the rects measured here are only good for drawing
 * the passage while the question about it is being written.
 */
export const measureEpubSelection: MeasureSelection = (pageEl) => {
  const selection = window.getSelection();
  const content = pageEl?.querySelector(`[${CHAPTER_CONTENT_ATTR}]`);
  if (!selection?.rangeCount || !pageEl || !content) return null;

  const offsets = textOffsetsOf(content, selection.getRangeAt(0));
  const range = offsets ? rangeOfTextOffsets(content, offsets) : null;
  const text = range?.toString().trim();
  if (!offsets || !range || !text) return null;

  const rect = range.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  return {
    position: { x: rect.left - pageRect.left, y: rect.top - pageRect.top, width: rect.width },
    selectedText: text,
    selectionPosition: {
      startIndex: offsets.start,
      endIndex: offsets.end,
      pageNumber: Number(pageEl.dataset.pageContainer),
      rects: selectionOnPage(range, pageEl).rects,
      pageWidth: pageRect.width,
    },
  };
};

/**
 * The reader for an EPUB: one chapter at a time, drawn as text in the reader's
 * own type and scrolled through, with the chapter standing in for the page
 * everywhere else in the app.
 */
export function EpubViewer({
  pdfId,
  book,
  bookError,
  onSelectionClick,
  measureSelection = measureEpubSelection,
  saveSelection,
}: EpubViewerProps) {
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom);
  const [outlineOpen, setOutlineOpen] = useAtom(outlineOpenAtom);
  const citedPassage = useAtomValue(citedPassageAtom);
  const setCitedPassage = useSetAtom(citedPassageAtom);
  const activeSelection = useAtomValue(activeSelectionAtom);
  const useWebSearch = useAtomValue(useWebSearchAtom);
  const isNarrow = useIsNarrow();

  const { epub, error: documentError } = useEpubDocument(pdfId);
  const { highlights, addHighlight } = useHighlights(book?.id);
  const { askAboutSelection, saveError } = useAskAboutSelection(addHighlight, saveSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Where in the next chapter an in-book link asked to land. */
  const pendingAnchorRef = useRef<string | null>(null);

  const [popoverState, setPopoverState] = useState<SelectionPopoverState | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [chosenByFinger, setChosenByFinger] = useState(false);
  const offerFirst = isNarrow || chosenByFinger;
  /** The chapter's drawn size, which every rect over it is measured at. */
  const [drawnSize, setDrawnSize] = useState({ width: 0, height: 0 });

  const chapters = epub?.book.chapters;
  const pageCount = book?.pageCount ?? chapters?.length ?? 1;
  const chapter = chapters?.[Math.min(currentPage, chapters.length) - 1];

  /** The chapter, made safe to draw. Built once per chapter, not per render. */
  const chapterElement = useMemo(
    () =>
      epub && chapter
        ? renderChapter(chapter.source, chapter.path, { imageUrl: epub.imageUrl })
        : null,
    [epub, chapter],
  );

  const pageByPath = useMemo(
    () => new Map((chapters ?? []).map((item, i) => [item.path, i + 1])),
    [chapters],
  );

  // Put the chapter in, and start it from the top — or from where the link the
  // reader followed into it pointed. A layout effect so the reader never sees
  // the next chapter scrolled to where the last one was left.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.replaceChildren(...(chapterElement ? [chapterElement] : []));
    chapterElement?.setAttribute(CHAPTER_CONTENT_ATTR, "");

    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const target = anchor ? document.getElementById(`${EPUB_ID_PREFIX}${anchor}`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [chapterElement]);

  // The rects over the chapter are measured against it, so a chapter that has
  // reflowed — the pane resized, an image arrived — is measured again.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDrawnSize({ width, height }));
    });
    observer.observe(page);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [chapterElement]);

  /** The highlights of this chapter, drawn from where they sit in its text. */
  const [drawnHighlights, setDrawnHighlights] = useState<
    { id: string; pageNumber: number; positionData: PositionData; color: string }[]
  >([]);
  const [citedSelection, setCitedSelection] = useState<PageSelection | null>(null);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !chapterElement) {
      setDrawnHighlights([]);
      return;
    }

    setDrawnHighlights(
      highlights
        .filter((highlight) => highlight.pageNumber === currentPage)
        .map((highlight) => {
          const { textRange } = highlight.positionData;
          if (!textRange) return highlight;
          const range = rangeOfTextOffsets(chapterElement, textRange);
          return {
            ...highlight,
            positionData: range ? selectionOnPage(range, page) : { rects: [] },
          };
        }),
    );
  }, [highlights, chapterElement, currentPage, drawnSize]);

  // The passage a citation quoted, marked and brought into view. A chapter is
  // far longer than a page, so turning to it is not enough to show it.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!citedPassage || !page || !chapterElement) {
      setCitedSelection(null);
      return;
    }
    // Reading on ends the mark, as it does on a PDF page.
    if (citedPassage.pageNumber !== currentPage) {
      setCitedPassage(null);
      return;
    }
    const range = rangeOfQuote(chapterElement, citedPassage.text);
    setCitedSelection(range ? selectionOnPage(range, page) : null);
  }, [citedPassage, chapterElement, currentPage, drawnSize, setCitedPassage]);

  const citedRef = useRef(citedPassage);
  useEffect(() => {
    if (citedPassage === citedRef.current || !citedSelection) return;
    citedRef.current = citedPassage;
    scrollPassageIntoView(containerRef.current, pageRef.current, citedSelection);
  }, [citedPassage, citedSelection]);

  // A highlight opened from the list may be far down its chapter.
  const shownSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSelection || activeSelection.id === shownSelectionRef.current) return;
    const drawn = drawnHighlights.find((highlight) => highlight.id === activeSelection.id);
    if (!drawn?.positionData.rects.length) return;
    shownSelectionRef.current = activeSelection.id;
    scrollPassageIntoView(containerRef.current, pageRef.current, drawn.positionData);
  }, [activeSelection, drawnHighlights]);

  const handleShortcut = useCallback(
    (action: ViewerAction) => {
      switch (action) {
        case "nextPage":
          setCurrentPage((page) => Math.min(pageCount, page + 1));
          break;
        case "prevPage":
          setCurrentPage((page) => Math.max(1, page - 1));
          break;
        case "firstPage":
          setCurrentPage(1);
          break;
        case "lastPage":
          setCurrentPage(pageCount);
          break;
        case "scrollDown":
          containerRef.current?.scrollBy({ top: SCROLL_STEP });
          break;
        case "scrollUp":
          containerRef.current?.scrollBy({ top: -SCROLL_STEP });
          break;
        case "toggleOutline":
          setOutlineOpen((open) => !open);
          break;
      }
    },
    [pageCount, setCurrentPage, setOutlineOpen],
  );
  useKeyboardShortcuts(handleShortcut);

  const handleOutlineJump = useCallback(
    (pageNumber: number) => {
      setCurrentPage(pageNumber);
      if (isNarrow) setOutlineOpen(false);
    },
    [isNarrow, setCurrentPage, setOutlineOpen],
  );

  /** Follows a link into the book: to the chapter it names, and the place in it. */
  const handleChapterClick = useCallback(
    (event: React.MouseEvent) => {
      const link = (event.target as Element).closest(`a[${EPUB_HREF_ATTR}]`);
      if (!link) return;
      event.preventDefault();

      const target = link.getAttribute(EPUB_HREF_ATTR) ?? "";
      const hash = target.indexOf("#");
      const path = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? null : target.slice(hash + 1);
      const page = pageByPath.get(path);
      if (page === undefined) return;

      if (page === currentPage) {
        if (anchor) document.getElementById(`${EPUB_ID_PREFIX}${anchor}`)?.scrollIntoView();
        return;
      }
      pendingAnchorRef.current = anchor;
      setCurrentPage(page);
    },
    [currentPage, pageByPath, setCurrentPage],
  );

  useSettledSelection(
    useCallback(
      (pointerType: string | null) => {
        const measured = measureSelection(selectedPageElement());
        if (!measured) return;
        setPopoverState(measured);
        setChosenByFinger(pointerType === "touch");
      },
      [measureSelection],
    ),
    { enabled: !questionOpen },
  );

  const handlePopoverSubmit = useCallback(
    async (question: string) => {
      if (!popoverState || !book) return;
      const { startIndex, endIndex, pageNumber, rects, pageWidth } = popoverState.selectionPosition;

      const asked = await askAboutSelection(
        book.id,
        {
          selectedText: popoverState.selectedText,
          pageNumber,
          positionData: { rects, pageWidth, textRange: { start: startIndex, end: endIndex } },
        },
        question,
        useWebSearch,
      );

      // As on a PDF page: the popover closes on the stored highlight, and one
      // that was not stored keeps the question for another try.
      if (asked.isOk()) {
        setPopoverState(null);
        setQuestionOpen(false);
      }
    },
    [popoverState, book, askAboutSelection, useWebSearch],
  );

  const handlePopoverDismiss = useCallback(() => {
    setPopoverState(null);
    setQuestionOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleHighlightClick = useCallback(
    (selectionId: string) => {
      const highlight = highlights.find((h) => h.id === selectionId);
      if (!highlight) return;
      onSelectionClick({
        id: highlight.id,
        selectedText: highlight.selectedText,
        pageNumber: highlight.pageNumber,
      });
    },
    [highlights, onSelectionClick],
  );

  const pending =
    popoverState && popoverState.selectionPosition.pageNumber === currentPage
      ? {
          rects: popoverState.selectionPosition.rects,
          pageWidth: popoverState.selectionPosition.pageWidth,
        }
      : null;

  const outlinePanel = (
    <PdfOutline
      outline={epub?.book.outline ?? null}
      error={null}
      currentPage={currentPage}
      onJump={handleOutlineJump}
    />
  );

  return (
    <div className="relative flex flex-col h-full bg-gray-100">
      {bookError ? (
        <div className="flex items-center justify-center flex-1">
          <div className="text-red-500 text-lg">エラーが発生しました: {bookError.message}</div>
        </div>
      ) : null}

      {documentError !== null ? (
        <div className="flex items-center justify-center flex-1">
          <p role="alert" className="text-red-500 text-lg">
            EPUBを表示できません: {documentError}
          </p>
        </div>
      ) : null}

      {!bookError && documentError === null && !epub ? (
        <div className="flex items-center justify-center flex-1">
          <div className="text-gray-500 text-lg">EPUBを読み込み中...</div>
        </div>
      ) : null}

      {saveError !== null ? (
        <p role="alert" className="m-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
          ハイライトを保存できませんでした: {saveError}
        </p>
      ) : null}

      {epub && (
        <div className="relative flex min-h-0 flex-1">
          {outlineOpen &&
            (isNarrow ? (
              <>
                <button
                  type="button"
                  aria-label="目次を閉じる"
                  onClick={() => setOutlineOpen(false)}
                  className="absolute inset-0 z-20 bg-black/40"
                />
                <div className="absolute inset-y-0 left-0 z-30 flex shadow-xl">{outlinePanel}</div>
              </>
            ) : (
              outlinePanel
            ))}

          <div ref={containerRef} className="flex-1 overflow-auto px-3 py-4 md:px-6">
            <article className="mx-auto max-w-2xl rounded-sm bg-white px-5 py-8 shadow-sm md:px-10">
              <div ref={pageRef} data-page-container={currentPage} className="relative">
                {/* Filled by hand with the chapter `renderChapter` built, never
                    by React: the markup is the book's, rebuilt from an
                    allowlist, and handing it to React as a string would only
                    have it parsed a second time. */}
                <div ref={contentRef} className="epubChapter" onClick={handleChapterClick} />
                <HighlightOverlay
                  highlights={drawnHighlights}
                  pageNumber={currentPage}
                  containerWidth={drawnSize.width}
                  containerHeight={drawnSize.height}
                  basePageWidth={drawnSize.width}
                  pending={pending}
                  cited={citedSelection}
                  onHighlightClick={handleHighlightClick}
                />

                {popoverState &&
                  !offerFirst &&
                  popoverState.selectionPosition.pageNumber === currentPage && (
                    <div
                      className="absolute z-50 w-80"
                      style={{
                        left: Math.min(
                          Math.max(
                            0,
                            popoverState.position.x + popoverState.position.width / 2 - 160,
                          ),
                          Math.max(0, drawnSize.width - 320),
                        ),
                        top: Math.max(0, popoverState.position.y - 130),
                      }}
                    >
                      <SelectionPopover
                        quote={popoverState.selectedText}
                        onSubmit={handlePopoverSubmit}
                        onDismiss={handlePopoverDismiss}
                      />
                    </div>
                  )}
              </div>
            </article>

            {/* At the end of a chapter is where the next one is wanted. One
                column holds the same controls at the bottom of the window. */}
            {!isNarrow && (
              <div className="flex items-center justify-center py-4">
                <PageStepper pageCount={pageCount} />
              </div>
            )}
          </div>
        </div>
      )}

      {offerFirst && popoverState && !questionOpen && (
        <SelectionActionBar
          quote={popoverState.selectedText}
          onAsk={() => setQuestionOpen(true)}
          onDismiss={handlePopoverDismiss}
        />
      )}

      {offerFirst && popoverState && questionOpen && (
        <div className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(19,26,41,0.18)]">
          <SelectionPopover
            quote={popoverState.selectedText}
            onSubmit={handlePopoverSubmit}
            onDismiss={() => setQuestionOpen(false)}
            floating={false}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Scroll the chapter so the first line of a passage is in view, leaving it be
 * when it already is.
 */
function scrollPassageIntoView(
  container: HTMLElement | null,
  page: HTMLElement | null,
  passage: { rects: { y: number; height: number }[] },
) {
  const first = passage.rects[0];
  if (!container || !page || !first) return;
  const view = container.getBoundingClientRect();
  const top = page.getBoundingClientRect().top + first.y;
  if (top >= view.top && top + first.height <= view.bottom) return;
  container.scrollTop += top - view.top - view.height / 3;
}
