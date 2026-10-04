// oxlint-disable-next-line no-restricted-imports -- 無害化した章の DOM への差し込み、ペインと章の ResizeObserver と画像の load の購読、描かれた章からのハイライトと引用箇所の計測に必要
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { citedPassageAtom, currentPageAtom, outlineOpenAtom } from "../../atoms/pdfAtom";
import { activeSelectionAtom, type ActiveSelection } from "../../atoms/chatAtom";
import { bookSearchOpenAtom } from "../../atoms/bookSearchAtom";
import { epubProgressAtom, epubScreenAtom, shownScreen, turnEpubAtom } from "../../atoms/epubAtom";
import { epubTypographyAtom, useWebSearchAtom } from "../../atoms/settingsAtom";
import { epubTypographyStyle } from "../../lib/epubTypography";
import type { BookDetail, PageDirection } from "../../../shared/schemas/book";
import type { HighlightColor, PositionData } from "../../../shared/schemas/selection";
import { PdfOutline } from "../PdfViewer/PdfOutline";
import { EpubPageStepper } from "./EpubPageStepper";
import {
  POPOVER_LIFT_PX,
  SelectionPopover,
  type SelectionBoxMode,
} from "../PdfViewer/SelectionPopover";
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
import {
  rangeOfQuote,
  rangeOfTextOffsets,
  screenOfTextOffset,
  textOffsetOfScreen,
  textOffsetsOf,
} from "../../lib/epubTextRange";
import { pagedLayout, screenCount, screenOfX } from "../../lib/epubPaging";
import { anchorOffset, entryPercent, epubProgress, mapEpubBook } from "../../lib/epubProgress";
import { resolveSwipe, resolveTapZone, type PageTurn } from "../../lib/touchNavigation";
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

/** As on a PDF page: further than this, or longer, and a press was not a tap. */
const TAP_SLOP_PX = 12;
const TAP_MAX_MS = 500;

/** The width of the floating question box (`w-80`), kept inside the screen it is on. */
const POPOVER_WIDTH_PX = 320;

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
 * What a chapter was last laid out for, which decides what a change to any of
 * it means for the screen the reader is on.
 */
interface Placed {
  chapter: Element;
  viewWidth: number;
  viewHeight: number;
  columns: number;
  typography: unknown;
  layoutVersion: number;
  screen: number;
}

/**
 * The reader for an EPUB: one chapter at a time, drawn as text in the reader's
 * own type and cut by the browser into screens as tall as the window, which are
 * turned one at a time. The chapter stands in for the page everywhere else in
 * the app; the screen is the reader's alone (`epubScreenAtom`).
 */
export function EpubViewer({
  pdfId,
  book,
  bookError,
  onSelectionClick,
  measureSelection = measureEpubSelection,
  saveSelection,
}: EpubViewerProps) {
  // Which way the book opens, as the reader chose it for this book: every left
  // and right of the screen — the edges, a swipe, the chevrons — is read as
  // back or on through `turnToward` (`touchNavigation.ts`) with this. The keyboard hears it too, but
  // in `useKeyboardShortcuts`, whose arrows already come back as on and back.
  const direction: PageDirection = book?.pageDirection ?? "ltr";
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom);
  const [outlineOpen, setOutlineOpen] = useAtom(outlineOpenAtom);
  const [epubScreen, setEpubScreen] = useAtom(epubScreenAtom);
  const turnScreen = useSetAtom(turnEpubAtom);
  const setEpubProgress = useSetAtom(epubProgressAtom);
  const citedPassage = useAtomValue(citedPassageAtom);
  const setCitedPassage = useSetAtom(citedPassageAtom);
  const setBookSearchOpen = useSetAtom(bookSearchOpenAtom);
  const activeSelection = useAtomValue(activeSelectionAtom);
  const useWebSearch = useAtomValue(useWebSearchAtom);
  const typography = useAtomValue(epubTypographyAtom);
  const typographyStyle = useMemo(() => epubTypographyStyle(typography), [typography]);
  const isNarrow = useIsNarrow();

  const { epub, error: documentError } = useEpubDocument(pdfId);
  const { highlights, addHighlight } = useHighlights(book?.id);
  const { askAboutSelection, markSelection, saveError } = useAskAboutSelection(
    addHighlight,
    saveSelection,
  );

  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Where in the next chapter an in-book link asked to land. */
  const pendingAnchorRef = useRef<string | null>(null);

  const [popoverState, setPopoverState] = useState<SelectionPopoverState | null>(null);
  // As in PdfViewer: which use the box was opened on, and a mark in flight.
  const [boxOpen, setBoxOpen] = useState<SelectionBoxMode | null>(null);
  const [marking, setMarking] = useState(false);
  const [chosenByFinger, setChosenByFinger] = useState(false);
  const offerFirst = isNarrow || chosenByFinger;
  /** The room the screens are laid out in: the pane, inside its own margins. */
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  /** The chapter's drawn size, which every rect over it is measured at. */
  const [drawnSize, setDrawnSize] = useState({ width: 0, height: 0 });
  /** Bumped when an image of the chapter arrives, which lays the columns out again. */
  const [layoutVersion, setLayoutVersion] = useState(0);

  const layout = useMemo(() => pagedLayout(paneSize.width), [paneSize.width]);
  const { screen } = shownScreen(epubScreen, currentPage);

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

  /**
   * What the reader's place is measured against: how much text each chapter
   * holds, and where in its chapter each entry of the contents starts. Read once
   * per book — every chapter is rebuilt for it, off the page.
   */
  const bookMap = useMemo(
    () => (epub ? mapEpubBook(epub.book.chapters, epub.book.outline) : null),
    [epub],
  );

  const pageByPath = useMemo(
    () => new Map((chapters ?? []).map((item, i) => [item.path, i + 1])),
    [chapters],
  );

  // Put the chapter in. Which screen of it is shown is the next effect's to
  // decide, once it has been laid out.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.replaceChildren(...(chapterElement ? [chapterElement] : []));
    chapterElement?.setAttribute(CHAPTER_CONTENT_ATTR, "");
  }, [chapterElement]);

  // The screens are as wide and as tall as the pane, and every rect over the
  // chapter is measured against it: a pane that changes size — the window, the
  // splitter, a panel folded — lays the chapter out again, and so does an image
  // of it arriving, which takes room the columns had given to text.
  useEffect(() => {
    const area = areaRef.current;
    const page = pageRef.current;
    const content = contentRef.current;
    if (!area || !page || !content) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pane = area.getBoundingClientRect();
        const drawn = page.getBoundingClientRect();
        setPaneSize({ width: pane.width, height: pane.height });
        setDrawnSize({ width: drawn.width, height: drawn.height });
      });
    });
    observer.observe(area);
    observer.observe(page);

    const relayout = () => setLayoutVersion((version) => version + 1);
    // `load` does not bubble; caught on the way down instead
    content.addEventListener("load", relayout, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      content.removeEventListener("load", relayout, true);
    };
  }, [epub]);

  /**
   * Where in the chapter's text the reader is: the first character of the
   * screen they turned to, or the passage they were taken to. Kept so a chapter
   * laid out again — at another width, in another type — opens at the same
   * words rather than at the same screen number, which by then holds others.
   */
  const readingOffsetRef = useRef(0);
  /**
   * The same place, for what is drawn from it: how far into the book the reader
   * is, and which entry of the contents is lit. The ref is what the layout
   * reads back while it is being worked out; this follows it.
   */
  const [readingOffset, setReadingOffset] = useState(0);
  /** A passage the next screen is being shown for, to be held to instead of its screen's start. */
  const passageOffsetRef = useRef<number | null>(null);
  const placedRef = useRef<Placed | null>(null);

  // Count the screens the chapter fills and settle which one is shown: where a
  // link into the chapter pointed or the end a turn back asked for, for a
  // chapter just put in; the screen the reader's words are now on, for one laid
  // out again; and the screen a turn asked for otherwise. A layout effect, so
  // the reader never sees the chapter at a screen it is not going to stay on.
  useLayoutEffect(() => {
    const page = pageRef.current;
    const content = contentRef.current;
    if (!page || !content || !chapterElement || layout.viewWidth <= 0) return;

    const laidOut = screenCount(content.scrollWidth, layout);
    const asked = epubScreen.page === currentPage ? epubScreen.screen : 0;
    const placed = placedRef.current;
    const relaidOut =
      placed !== null &&
      (placed.viewWidth !== layout.viewWidth ||
        placed.viewHeight !== paneSize.height ||
        placed.columns !== layout.columns ||
        placed.typography !== typography ||
        placed.layoutVersion !== layoutVersion);

    let target: number;
    let holdReading = false;
    if (!placed || placed.chapter !== chapterElement) {
      const anchor = pendingAnchorRef.current;
      pendingAnchorRef.current = null;
      const element = anchor ? document.getElementById(`${EPUB_ID_PREFIX}${anchor}`) : null;
      // Held to where the anchor is rather than to the first words of its
      // screen: a section that starts part way down a screen is the one the
      // reader asked for, and the one the contents should light up.
      if (anchor && element) passageOffsetRef.current = anchorOffset(chapterElement, anchor);
      target = element
        ? screenOfX(
            element.getBoundingClientRect().left - page.getBoundingClientRect().left,
            layout.viewWidth,
          )
        : asked === "last"
          ? laidOut - 1
          : asked;
    } else if (relaidOut) {
      target =
        screenOfTextOffset(chapterElement, page, layout.viewWidth, readingOffsetRef.current) ??
        placed.screen;
      holdReading = true;
    } else {
      target = asked === "last" ? laidOut - 1 : asked;
      holdReading = target === placed.screen && passageOffsetRef.current === null;
    }
    target = Math.min(Math.max(0, target), laidOut - 1);

    if (!holdReading) {
      readingOffsetRef.current =
        passageOffsetRef.current ??
        textOffsetOfScreen(chapterElement, page, layout.viewWidth, target) ??
        0;
    }
    passageOffsetRef.current = null;
    setReadingOffset(readingOffsetRef.current);

    placedRef.current = {
      chapter: chapterElement,
      viewWidth: layout.viewWidth,
      viewHeight: paneSize.height,
      columns: layout.columns,
      typography,
      layoutVersion,
      screen: target,
    };
    if (
      epubScreen.page !== currentPage ||
      epubScreen.screen !== target ||
      epubScreen.count !== laidOut
    ) {
      setEpubScreen({ page: currentPage, screen: target, count: laidOut });
    }
  }, [
    chapterElement,
    layout,
    paneSize.height,
    typography,
    layoutVersion,
    epubScreen,
    currentPage,
    setEpubScreen,
  ]);

  // What the stepper says of the place: worked out here, where the book's text
  // and the place in it both are, and handed to it wherever it is drawn.
  const progress = useMemo(
    () => (bookMap ? epubProgress(bookMap, currentPage, readingOffset) : null),
    [bookMap, currentPage, readingOffset],
  );
  useLayoutEffect(() => {
    setEpubProgress(progress);
  }, [progress, setEpubProgress]);

  /**
   * Turn to the screen a passage of this chapter is drawn on, and hold to the
   * passage — not the screen's first words — if the chapter is laid out again.
   */
  const showPassage = useCallback(
    (rects: { x: number }[], offset: number | null) => {
      const first = rects[0];
      if (!first) return;
      passageOffsetRef.current = offset;
      const target = screenOfX(first.x, layout.viewWidth);
      setEpubScreen((at) => ({
        page: currentPage,
        screen: target,
        count: at.page === currentPage ? at.count : 1,
      }));
    },
    [currentPage, layout.viewWidth, setEpubScreen],
  );

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
    // `typography` is here for what the observer cannot see: justifying the
    // text, or a face of the same metrics, moves the words without changing the
    // size of the box they are in. The layout is, for columns that move the
    // words without the box changing either.
  }, [highlights, chapterElement, currentPage, drawnSize, typography, layout, layoutVersion]);

  // The passage a citation quoted, marked and turned to: a chapter fills more
  // than one screen, so turning to the chapter is not enough to show it.
  const citedRef = useRef(citedPassage);
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
    const range = rangeOfQuote(chapterElement, citedPassage.text, citedPassage.context);
    const marked = range ? selectionOnPage(range, page) : null;
    setCitedSelection(marked);

    if (citedPassage === citedRef.current || !range || !marked) return;
    citedRef.current = citedPassage;
    showPassage(marked.rects, textOffsetsOf(chapterElement, range)?.start ?? null);
  }, [
    citedPassage,
    chapterElement,
    currentPage,
    drawnSize,
    typography,
    layout,
    layoutVersion,
    setCitedPassage,
    showPassage,
  ]);

  // A highlight opened from the list may be several screens into its chapter.
  const shownSelectionRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!activeSelection || activeSelection.id === shownSelectionRef.current) return;
    const drawn = drawnHighlights.find((highlight) => highlight.id === activeSelection.id);
    if (!drawn?.positionData.rects.length) return;
    shownSelectionRef.current = activeSelection.id;
    const stored = highlights.find((highlight) => highlight.id === activeSelection.id);
    showPassage(drawn.positionData.rects, stored?.positionData.textRange?.start ?? null);
  }, [activeSelection, drawnHighlights, highlights, showPassage]);

  const turn = useCallback(
    (way: PageTurn) => turnScreen({ turn: way, pageCount }),
    [turnScreen, pageCount],
  );

  /** To the start of a chapter, which is where the outline and gg / G go. */
  const openChapter = useCallback(
    (page: number) => {
      setEpubScreen({ page, screen: 0, count: 1 });
      setCurrentPage(page);
    },
    [setCurrentPage, setEpubScreen],
  );

  const handleShortcut = useCallback(
    (action: ViewerAction) => {
      switch (action) {
        // On and back already: the arrows and h / l were read as a side of the
        // screen against the book's direction by `useKeyboardShortcuts`, and
        // emacs's C-f / C-b never named a side. ↓ / ↑ and j / k turn too, since
        // a screen read a screen at a time has nothing in it to scroll.
        case "nextPage":
          turn("next");
          break;
        case "prevPage":
          turn("prev");
          break;
        case "scrollDown":
          turn("next");
          break;
        case "scrollUp":
          turn("prev");
          break;
        case "firstPage":
          openChapter(1);
          break;
        case "lastPage":
          openChapter(pageCount);
          break;
        case "toggleOutline":
          setOutlineOpen((open) => !open);
          break;
        case "openSearch":
          setBookSearchOpen(true);
          break;
      }
    },
    [turn, openChapter, pageCount, setOutlineOpen, setBookSearchOpen],
  );
  useKeyboardShortcuts(handleShortcut, direction);

  /**
   * To a chapter, and to the place in it an anchor names: where an entry of the
   * contents or a link in the book leads. A chapter can hold several sections,
   * so the chapter alone is not where a section's entry points.
   */
  const goToPlace = useCallback(
    (page: number, anchor: string | null) => {
      if (page !== currentPage) {
        pendingAnchorRef.current = anchor;
        openChapter(page);
        return;
      }
      const element = anchor ? document.getElementById(`${EPUB_ID_PREFIX}${anchor}`) : null;
      const pageRect = pageRef.current?.getBoundingClientRect();
      if (anchor && element && pageRect && chapterElement) {
        showPassage(
          [{ x: element.getBoundingClientRect().left - pageRect.left }],
          anchorOffset(chapterElement, anchor),
        );
        return;
      }
      openChapter(page);
    },
    [chapterElement, currentPage, openChapter, showPassage],
  );

  const handleOutlineJump = useCallback(
    (pageNumber: number, anchor?: string) => {
      goToPlace(pageNumber, anchor ?? null);
      if (isNarrow) setOutlineOpen(false);
    },
    [goToPlace, isNarrow, setOutlineOpen],
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
      goToPlace(page, anchor);
    },
    [goToPlace, pageByPath],
  );

  /**
   * Whether a gesture over the screen is the reader turning it. A passage under
   * offer means the gesture belongs to it, as on a PDF page.
   */
  const turnable = useCallback(() => {
    if (popoverState) return false;
    const selection = window.getSelection();
    return !selection || selection.isCollapsed;
  }, [popoverState]);

  /**
   * The edges of the screen turn it, a tap or a click alike, as a PDF page's
   * do; the middle is left alone (there is no zoom to spend a double tap on).
   * Whether a turn was on offer is decided when the press lands, for the
   * reason `PdfViewer` gives: the question box closes on the press first.
   */
  const tapRef = useRef<{ x: number; y: number; at: number; turnable: boolean } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      tapRef.current = {
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
        turnable: turnable(),
      };
    },
    [turnable],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = tapRef.current;
      tapRef.current = null;
      if (!start?.turnable) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
      if (event.timeStamp - start.at > TAP_MAX_MS) return;
      // The second press of a double click is a word being selected
      if (event.detail > 1) return;
      // A highlight, or a link, answers for itself
      if ((event.target as Element).closest("button, a")) return;

      const frame = event.currentTarget.getBoundingClientRect();
      if (frame.width <= 0) return;
      const zone = resolveTapZone((event.clientX - frame.left) / frame.width, direction);
      if (zone === "zoom") return;
      turn(zone);
    },
    [turn, direction],
  );

  const touchRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const first = event.touches[0];
    touchRef.current =
      event.touches.length === 1 && first
        ? { x: first.clientX, y: first.clientY, at: event.timeStamp }
        : null;
  }, []);

  /** A finger flicked across the screen turns it, as it turns a PDF page. */
  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchRef.current;
      touchRef.current = null;
      const last = event.changedTouches[0];
      if (!start || !last || !turnable()) return;
      const swiped = resolveSwipe(
        {
          dx: last.clientX - start.x,
          dy: last.clientY - start.y,
          durationMs: event.timeStamp - start.at,
        },
        direction,
      );
      if (swiped) turn(swiped);
    },
    [turnable, turn, direction],
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
    { enabled: boxOpen === null },
  );

  const handlePopoverSubmit = useCallback(
    async (question: string) => {
      if (!popoverState || !book) return;
      const asked = await askAboutSelection(book.id, draftOf(popoverState), question, useWebSearch);

      // As on a PDF page: the popover closes on the stored highlight, and one
      // that was not stored keeps the question for another try.
      if (asked.isOk()) {
        setPopoverState(null);
        setBoxOpen(null);
      }
    },
    [popoverState, book, askAboutSelection, useWebSearch],
  );

  const handlePopoverDismiss = useCallback(() => {
    setPopoverState(null);
    setBoxOpen(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // A highlight and nothing more, closed on the stored highlight as on a PDF page.
  const handleMark = useCallback(
    async (color: HighlightColor, note: string | null) => {
      if (!popoverState || !book) return;

      setMarking(true);
      const marked = await markSelection(book.id, {
        ...draftOf(popoverState),
        color,
        ...(note === null ? {} : { note }),
      });
      setMarking(false);

      if (marked.isOk()) handlePopoverDismiss();
    },
    [popoverState, book, markSelection, handlePopoverDismiss],
  );

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

  /** Where the screen being read starts, in the chapter as laid out. */
  const shownLeft = screen * layout.viewWidth;

  const outlinePanel = (
    <PdfOutline
      outline={bookMap?.outline ?? null}
      error={null}
      currentPage={currentPage}
      currentOffset={readingOffset}
      onJump={handleOutlineJump}
      // How far into the book, rather than the page: an EPUB's page is an item
      // of its spine, which several sections can share and no reader counts by.
      entryLabel={(entry) => (bookMap ? `${entryPercent(bookMap, entry)}%` : null)}
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

          <div className="flex min-w-0 flex-1 flex-col px-3 py-4 md:px-6">
            <div ref={areaRef} className="flex min-h-0 flex-1 justify-center">
              {/* The paper: as wide as the screens laid side by side and as tall
                  as the pane, clipping the columns that run on either side of
                  the one being read. The reader's type is set here as custom
                  properties, which `index.css` reads: the chapter inside is
                  built by hand rather than by React, so this is the element
                  React can style. */}
              <article
                style={{
                  ...typographyStyle,
                  width: layout.viewWidth > 0 ? layout.viewWidth : undefined,
                }}
                className="epubPage relative h-full w-full overflow-clip rounded-sm bg-white py-8 shadow-sm"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {/* Moved along the columns to the screen being read. The
                    overlays travel with it, so a rect measured against it
                    stays on its words whichever screen is up. */}
                <div
                  ref={pageRef}
                  data-page-container={currentPage}
                  className="relative h-full"
                  style={{ transform: `translateX(${-shownLeft}px)` }}
                >
                  {/* Filled by hand with the chapter `renderChapter` built,
                      never by React: the markup is the book's, rebuilt from an
                      allowlist, and handing it to React as a string would only
                      have it parsed a second time. Laid out in columns as tall
                      as this box, one to a screen (or two, for a spread). */}
                  <div
                    ref={contentRef}
                    className="epubChapter epubColumns"
                    style={
                      {
                        columnCount: layout.columns,
                        "--epub-column-height": `${drawnSize.height}px`,
                      } as React.CSSProperties
                    }
                    onClick={handleChapterClick}
                  />
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
                              shownLeft,
                              popoverState.position.x +
                                popoverState.position.width / 2 -
                                POPOVER_WIDTH_PX / 2,
                            ),
                            Math.max(shownLeft, shownLeft + layout.viewWidth - POPOVER_WIDTH_PX),
                          ),
                          top: Math.max(0, popoverState.position.y - POPOVER_LIFT_PX),
                        }}
                      >
                        <SelectionPopover
                          quote={popoverState.selectedText}
                          onSubmit={handlePopoverSubmit}
                          onMark={handleMark}
                          onDismiss={handlePopoverDismiss}
                        />
                      </div>
                    )}
                </div>
              </article>
            </div>

            {/* Under the screen, where the next one is wanted. One column holds
                the same controls at the bottom of the window. */}
            {!isNarrow && (
              <div
                role="group"
                aria-label="ページ送り"
                className="flex shrink-0 items-center justify-center pt-2"
              >
                <EpubPageStepper pageCount={pageCount} direction={direction} />
              </div>
            )}
          </div>
        </div>
      )}

      {offerFirst && popoverState && boxOpen === null && (
        <SelectionActionBar
          quote={popoverState.selectedText}
          onAsk={() => setBoxOpen("ask")}
          onNote={() => setBoxOpen("note")}
          onMark={(color) => void handleMark(color, null)}
          onDismiss={handlePopoverDismiss}
          marking={marking}
        />
      )}

      {offerFirst && popoverState && boxOpen !== null && (
        <div className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(19,26,41,0.18)]">
          <SelectionPopover
            quote={popoverState.selectedText}
            onSubmit={handlePopoverSubmit}
            onMark={handleMark}
            onDismiss={() => setBoxOpen(null)}
            initialMode={boxOpen}
            floating={false}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What is stored for a passage chosen in a chapter: where it sits in the
 * chapter's text, which is what the highlight is drawn from, beside the rects
 * measured at the width it was chosen at.
 */
function draftOf(chosen: SelectionPopoverState) {
  const { startIndex, endIndex, pageNumber, rects, pageWidth } = chosen.selectionPosition;
  return {
    selectedText: chosen.selectedText,
    pageNumber,
    positionData: { rects, pageWidth, textRange: { start: startIndex, end: endIndex } },
  };
}
