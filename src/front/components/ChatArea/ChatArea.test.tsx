import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { ChatArea } from "./ChatArea";
import {
  doneEvent,
  errorEvent,
  streamingFetchStub,
  tokenEvent,
} from "../../../test/streamingFetchStub";
import {
  activeSelectionAtom,
  activeSessionAtom,
  chatAbortControllerAtom,
  chatMessagesAtom,
  chatScopeAtom,
  isStreamingAtom,
  type ActiveSelection,
  type OpenSession,
} from "../../atoms/chatAtom";
import type { ChatListRequests } from "../../hooks/useChatList";
import { chaptersKey } from "../../hooks/useChapters";
import { ApiError } from "../../lib/fetcher";
import type { ChatSummary, PageRange } from "../../../shared/schemas/chat";
import type { BookChapter } from "../../../shared/schemas/book";
import type { ChatQuoteSelection } from "../../lib/chatQuoteSelection";
import type { SelectionHighlight } from "../../../shared/schemas/selection";
import type { BookDetail } from "../../../shared/schemas/book";
import { bookKey } from "../../hooks/useBook";
import type { DeleteHighlight, UpdateHighlight } from "../../hooks/useHighlights";
import type { SearchSelections } from "../../hooks/useHighlightSearch";
import { SwrTestCache } from "../../../test/swrTestCache";

const SELECTED_TEXT = "エッジはサーバーレス実行基盤で、実行単位をまたいでメモリを共有できません。";
const OTHER_TEXT = "Durable Objects は単一のインスタンスに処理を集約します。";

const HIGHLIGHTS: SelectionHighlight[] = [
  {
    id: "s1",
    selectedText: SELECTED_TEXT,
    pageNumber: 42,
    positionData: { rects: [] },
    color: "#FFEB3B",
    note: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "s2",
    selectedText: OTHER_TEXT,
    pageNumber: 7,
    positionData: { rects: [] },
    color: "#2196F3",
    note: null,
    createdAt: "2026-08-02T10:00:00.000Z",
  },
];

const BOOK: BookDetail = {
  title: null,
  id: "p1",
  fileName: "Cloudflare Workers.pdf",
  format: "pdf",
  pageCount: 209,
  hasThumbnail: true,
  hasOutline: true,
  pageDirection: "ltr",
  hasOcr: false,
  selections: HIGHLIGHTS,
  readingState: null,
};

/** An answer already in the thread, for the reader to pick a passage out of. */
const ANSWER = "エッジではメモリを共有できないため、状態は Durable Objects に置きます。";

const ANSWER_MESSAGE = {
  id: "m1",
  role: "assistant" as const,
  content: ANSWER,
  createdAt: "2026-08-03T10:00:00.000Z",
};

function renderChat(
  options: {
    activeSelection?: ActiveSelection | null;
    /** Set to render the panel as it looks when the book itself failed to load. */
    bookError?: Error;
    /** Put in the thread before rendering, so a passage can be dragged over. */
    messages?: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[];
    /** Stands in for the delete endpoint the list reaches for. */
    deleteHighlight?: DeleteHighlight;
    /** Stands in for the endpoint that recolours a highlight or rewrites its note. */
    changeHighlight?: UpdateHighlight;
    /** Stands in for the search endpoint, which looks through the chats too. */
    searchHighlights?: SearchSelections;
    /** Opens the panel on a chat about the book rather than a passage's. */
    session?: OpenSession | null;
    /** The pages that chat is aimed at. */
    scope?: PageRange[];
    /** The book's chapters, as the scope menu reads them. */
    chapters?: BookChapter[];
    /** What the chat list holds. */
    chats?: ChatSummary[];
    /** Stands in for the chat list's endpoints, over the list above. */
    chatRequests?: ChatListRequests;
    onNewChat?: () => void;
    onOpenSession?: (sessionId: string) => void;
  } = {},
) {
  const {
    activeSelection = { id: "s1", selectedText: SELECTED_TEXT, pageNumber: 42 },
    bookError,
    messages = [],
    deleteHighlight,
    changeHighlight,
    searchHighlights,
    session = null,
    scope = [],
    chapters,
    chats = [],
    chatRequests = {},
    onNewChat = () => {},
    onOpenSession = () => {},
  } = options;
  const book = bookError ? undefined : BOOK;
  const store = createStore();
  store.set(activeSelectionAtom, activeSelection);
  store.set(activeSessionAtom, session);
  store.set(chatScopeAtom, scope);
  store.set(chatMessagesAtom, messages);

  // Stands in for a drag over the thread: jsdom lays no text out and has no
  // Selection to read, so what a drag "selected" is set by the test.
  let selected: ChatQuoteSelection | null = null;

  const opened: ActiveSelection[] = [];
  const turnedTo: ActiveSelection[] = [];
  const seed: Record<string, unknown> = book ? { [bookKey(BOOK.id)]: BOOK } : {};
  if (chapters) seed[chaptersKey(BOOK.id)] = { chapters };
  render(
    // The highlights the panel lists come from the book's cache entry, the same
    // one the viewer draws from. A book that failed to load has no such entry,
    // so seeding one would contradict the state under test.
    <SwrTestCache seed={seed}>
      <Provider store={store}>
        <ChatArea
          book={book}
          bookError={bookError}
          onSelectionClick={(selection) => opened.push(selection)}
          onGoToHighlight={(selection) => turnedTo.push(selection)}
          onOpenSession={onOpenSession}
          onNewChat={onNewChat}
          chatRequests={{ load: async () => ({ chats }), ...chatRequests }}
          readQuote={() => selected}
          deleteHighlight={deleteHighlight}
          changeHighlight={changeHighlight}
          searchHighlights={searchHighlights}
        />
      </Provider>
    </SwrTestCache>,
  );

  return {
    store,
    opened,
    turnedTo,
    /** Drags over a message of the thread and takes up the offer to quote it. */
    quote: async (text: string) => {
      selected = { text, rect: { top: 0, left: 0, width: 0 } };
      document.dispatchEvent(new Event("selectionchange"));
      await userEvent.click(await screen.findByRole("button", { name: "引用して質問" }));
    },
  };
}

describe("ChatArea", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the question at once, then the answer as it streams in", async () => {
    // ChatArea's own fetch stands in for the chat endpoint, so the question
    // going through useChatStream — what makes it appear before the model
    // answers — is exercised rather than assumed.
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    renderChat();

    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "この段落を一言で要約して");
    await userEvent.keyboard("{Enter}");

    // The question and the wait are on screen before a single token arrives
    expect(screen.getByText("この段落を一言で要約して")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/^考え中…$/);

    await act(async () => {
      calls[0].emit(tokenEvent("要約すると"));
    });
    await waitFor(() => expect(screen.getByText("要約すると")).toBeVisible());
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      calls[0].emit(tokenEvent("、選択の話です。"));
      calls[0].emit(doneEvent("m1"));
      calls[0].end();
    });

    await waitFor(() => expect(screen.getByText("要約すると、選択の話です。")).toBeVisible());
    expect(calls.map((call) => [call.url, call.body])).toStrictEqual([
      [
        "/api/pdf/p1/selections/s1/chats",
        { content: "この段落を一言で要約して", useWebSearch: true },
      ],
    ]);
  });

  it("says why the answer never came instead of leaving the question unanswered", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    renderChat();

    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "この段落を一言で要約して");
    await userEvent.keyboard("{Enter}");
    await act(async () => {
      calls[0].emit(errorEvent("AI_API_ERROR", "upstream is down"));
      calls[0].end();
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /^回答の取得に失敗しました: upstream is down$/,
      ),
    );
    // The question stays on screen, and the wait that would suggest an answer
    // is still coming is over
    expect(screen.getByText("この段落を一言で要約して")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the selected passage the question is about", () => {
    renderChat();

    expect(screen.getByText(SELECTED_TEXT)).toBeInTheDocument();
  });

  it("says the book could not be read rather than showing it as one without highlights", () => {
    // The highlights come from the book itself, so a book that failed to load
    // is indistinguishable from one nobody has marked up yet.
    renderChat({ activeSelection: null, bookError: new Error("PDF not found") });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^ハイライトを読み込めませんでした: PDF not found$/,
    );
  });

  it("lists the book's highlights while no passage is selected", () => {
    renderChat({ activeSelection: null });

    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
    expect(screen.getByText(OTHER_TEXT)).toBeInTheDocument();
  });

  it("turns to a highlight picked from the list, and opens its chat from the button beside it", async () => {
    const { opened, turnedTo } = renderChat({ activeSelection: null });

    await userEvent.click(screen.getByText(OTHER_TEXT));

    expect(turnedTo).toStrictEqual([{ id: "s2", selectedText: OTHER_TEXT, pageNumber: 7 }]);
    expect(opened).toStrictEqual([]);

    await userEvent.click(
      screen.getByRole("button", { name: /^「Durable Objects.*」のチャットを開く$/ }),
    );

    expect(opened).toStrictEqual([{ id: "s2", selectedText: OTHER_TEXT, pageNumber: 7 }]);
  });

  it("counts on a highlight's chat button what the chat list says was said about it", async () => {
    renderChat({
      activeSelection: null,
      chats: [
        {
          kind: "highlight",
          id: "s2",
          selectedText: OTHER_TEXT,
          pageNumber: 7,
          color: "#2196F3",
          messageCount: 3,
          lastMessage: { role: "assistant", content: "はい" },
          updatedAt: "2026-08-03T10:00:00.000Z",
        },
      ],
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^「Durable Objects.*」のチャットを開く$/ }),
      ).toHaveTextContent("3"),
    );
  });

  it("goes between the chat list and the highlight list with one tap each way", async () => {
    renderChat({
      activeSelection: null,
      chats: [
        {
          kind: "book",
          id: "sess-1",
          title: null,
          firstQuestion: "この本を要約して",
          scope: null,
          messageCount: 2,
          lastMessage: { role: "assistant", content: "要約です" },
          updatedAt: "2026-08-03T10:00:00.000Z",
        },
      ],
    });
    expect(screen.getByRole("tab", { name: "ハイライト" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.click(screen.getByRole("tab", { name: "チャット" }));

    expect(await screen.findByText("この本を要約して")).toBeInTheDocument();
    expect(screen.queryByText("ハイライト 2件")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "ハイライト" }));

    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
    expect(screen.queryByText("この本を要約して")).toBeNull();
  });

  it("starts a new chat, and opens a session, off the chat list", async () => {
    const started = vi.fn();
    const sessions: string[] = [];
    renderChat({
      activeSelection: null,
      onNewChat: started,
      onOpenSession: (id) => sessions.push(id),
      chats: [
        {
          kind: "book",
          id: "sess-1",
          title: "第2章",
          firstQuestion: null,
          scope: null,
          messageCount: 0,
          lastMessage: null,
          updatedAt: "2026-08-03T10:00:00.000Z",
        },
      ],
    });
    await userEvent.click(screen.getByRole("tab", { name: "チャット" }));

    await userEvent.click(screen.getByRole("button", { name: "新しいチャット" }));
    await userEvent.click(await screen.findByText("第2章"));

    expect(started).toHaveBeenCalledTimes(1);
    expect(sessions).toStrictEqual(["sess-1"]);
  });

  it("makes a new chat's session with its first question, and asks it there", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const created: string[] = [];
    const { store } = renderChat({
      activeSelection: null,
      session: { id: null },
      chatRequests: {
        create: (pdfId) => {
          created.push(pdfId);
          return okAsync({
            id: "sess-new",
            title: null,
            scope: null,
            createdAt: "2026-08-03T10:00:00.000Z",
            updatedAt: "2026-08-03T10:00:00.000Z",
          });
        },
      },
    });
    expect(screen.getByRole("heading", { name: "新しいチャット" })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "この本を要約して");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(created).toStrictEqual([BOOK.id]);
    expect(store.get(activeSessionAtom)).toStrictEqual({ id: "sess-new" });
    expect(calls.map((call) => [call.url, call.body])).toStrictEqual([
      [
        "/api/pdf/p1/sessions/sess-new/messages",
        {
          content: "この本を要約して",
          useWebSearch: true,
          scope: { ranges: [{ startPage: 1, endPage: 209 }] },
        },
      ],
    ]);
  });

  it("asks a session's next question in that session, over its pages, without making another", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const create = vi.fn();
    renderChat({
      activeSelection: null,
      session: { id: "sess-1" },
      scope: [{ startPage: 5, endPage: 8 }],
      chapters: [
        { title: null, startPage: 1, endPage: 4 },
        { title: "Chapter 2", startPage: 5, endPage: 8 },
      ],
      chatRequests: { create },
    });
    expect(screen.getByRole("button", { name: "範囲: Chapter 2" })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "続きを");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(create).not.toHaveBeenCalled();
    expect(calls.map((call) => [call.url, call.body])).toStrictEqual([
      [
        "/api/pdf/p1/sessions/sess-1/messages",
        {
          content: "続きを",
          useWebSearch: true,
          scope: { ranges: [{ startPage: 5, endPage: 8 }] },
        },
      ],
    ]);
  });

  it("says a new chat could not be started, and asks nothing", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    renderChat({
      activeSelection: null,
      session: { id: null },
      chatRequests: {
        create: () => errAsync(new ApiError("Unexpected server error", "INTERNAL_ERROR", 500)),
      },
    });

    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "この本を要約して");
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "チャットを始められませんでした: Unexpected server error",
    );
    expect(calls).toStrictEqual([]);
  });

  it("names the open session from the chat list, and renames it there", async () => {
    const renamed: [string, string, string][] = [];
    renderChat({
      activeSelection: null,
      session: { id: "sess-1" },
      chats: [
        {
          kind: "book",
          id: "sess-1",
          title: null,
          firstQuestion: "この本を要約して",
          scope: null,
          messageCount: 2,
          lastMessage: { role: "assistant", content: "要約です" },
          updatedAt: "2026-08-03T10:00:00.000Z",
        },
      ],
      chatRequests: {
        rename: (pdfId, sessionId, title) => {
          renamed.push([pdfId, sessionId, title]);
          return okAsync({ id: sessionId, title });
        },
      },
    });
    expect(await screen.findByRole("heading", { name: "この本を要約して" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "チャットの名前を変更" }));
    const box = screen.getByRole("textbox", { name: "チャットの名前" });
    await userEvent.clear(box);
    await userEvent.type(box, "全体の要約");
    await userEvent.click(screen.getByRole("button", { name: "名前を保存" }));

    expect(renamed).toStrictEqual([[BOOK.id, "sess-1", "全体の要約"]]);
    expect(await screen.findByRole("heading", { name: "全体の要約" })).toBeInTheDocument();
  });

  it("offers no rename for a new chat the server does not have yet", () => {
    renderChat({ activeSelection: null, session: { id: null } });

    expect(screen.queryByRole("button", { name: "チャットの名前を変更" })).toBeNull();
  });

  it("shows a chat about the book with the scope it will be asked under and no passage quoted", () => {
    // The third face: no highlight under it, so no quote box — what the
    // question is aimed at is the scope chip instead.
    renderChat({ activeSelection: null, session: { id: "sess-1" } });

    expect(screen.getByRole("button", { name: "一覧に戻る" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "範囲: 本全体" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("質問を入力...")).toBeInTheDocument();
    expect(screen.queryByText("↳")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("hands the chapter list's failure to the menu rather than an empty list", async () => {
    // An empty list of chapters is what a book with no table of contents looks
    // like, so swallowing the failure would have the menu tell the reader the
    // book has none.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    renderChat({ activeSelection: null, session: { id: "sess-1" } });

    await userEvent.click(screen.getByRole("button", { name: /^範囲:/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "範囲の一覧を読み込めませんでした: Unexpected server error",
    );
    expect(screen.queryByText("この本には目次がありません")).toBeNull();
  });

  it("keeps the scope out of a highlight's conversation, which has a passage to go by instead", () => {
    renderChat();

    expect(screen.getByText(SELECTED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^範囲:/ })).toBeNull();
  });

  it("drops a quote taken in a chat about the book when the reader leaves it for the list", async () => {
    // A quote is a passage of the thread it was taken from; the list is not
    // that thread, so coming back from it starts the question over rather than
    // attaching it to a conversation the reader has stepped out of.
    const { store, quote } = renderChat({
      activeSelection: null,
      session: { id: "sess-1" },
      messages: [ANSWER_MESSAGE],
    });
    await quote(ANSWER);
    expect(screen.getByRole("button", { name: "引用を取り消す" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "一覧に戻る" }));
    act(() => {
      store.set(activeSessionAtom, { id: "sess-1" });
    });

    expect(screen.getByPlaceholderText("質問を入力...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "引用を取り消す" })).toBeNull();
  });

  it("narrows the list to what the server says holds the query, chats included", async () => {
    const asked: string[] = [];
    renderChat({
      activeSelection: null,
      // The chats are not in the book, so only the server can say that this
      // passage's conversation mentions it.
      searchHighlights: (_pdfId, query) => {
        asked.push(query);
        return Promise.resolve({ selectionIds: ["s2"] });
      },
    });

    await userEvent.type(screen.getByLabelText("ハイライトを検索"), "集約");
    // Typing alone asks nothing of the server; the button is what runs it.
    expect(asked).toStrictEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    await waitFor(() => expect(screen.getByText("ハイライト 2件中 1件")).toBeInTheDocument());
    expect(screen.getByText(OTHER_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SELECTED_TEXT)).toBeNull();
    expect(asked).toStrictEqual(["集約"]);
  });

  it("takes a deleted highlight out of the list the book shares with the viewer", async () => {
    const deleted: [string, string][] = [];
    renderChat({
      activeSelection: null,
      deleteHighlight: (pdfId, selectionId) => {
        deleted.push([pdfId, selectionId]);
        return okAsync({ deleted: true as const });
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /^「エッジはサーバーレス実行基盤.*」を削除$/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(screen.getByText("ハイライト 1件")).toBeInTheDocument());
    expect(deleted).toStrictEqual([[BOOK.id, "s1"]]);
    expect(screen.getByText(OTHER_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SELECTED_TEXT)).toBeNull();
  });

  it("leaves the chat a reader opened on a highlight while its deletion was in flight", async () => {
    // The gap between asking and being told is where this can happen: the list
    // is gone by then, so the answer has to look at the chat that is open now.
    let acceptDeletion: (() => void) | undefined;
    const { store } = renderChat({
      activeSelection: null,
      deleteHighlight: () =>
        ResultAsync.fromSafePromise(
          new Promise<{ deleted: true }>((resolve) => {
            acceptDeletion = () => resolve({ deleted: true });
          }),
        ),
    });

    await userEvent.click(
      screen.getByRole("button", { name: /^「エッジはサーバーレス実行基盤.*」を削除$/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    act(() => {
      store.set(activeSelectionAtom, { id: "s1", selectedText: SELECTED_TEXT, pageNumber: 42 });
    });
    expect(screen.getByPlaceholderText("質問を入力...")).toBeInTheDocument();

    await act(async () => {
      acceptDeletion!();
    });

    await waitFor(() => expect(store.get(activeSelectionAtom)).toBeNull());
    expect(screen.getByText("ハイライト 1件")).toBeInTheDocument();
  });

  it("returns to the highlight list when the chat is left", async () => {
    const { store } = renderChat();

    await userEvent.click(screen.getByRole("button", { name: "一覧に戻る" }));

    expect(store.get(activeSelectionAtom)).toBeNull();
    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
  });

  it("sends a passage quoted out of the thread above the question it prompted", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { quote } = renderChat({ messages: [ANSWER_MESSAGE] });

    await quote(ANSWER);
    await userEvent.type(
      screen.getByPlaceholderText("質問を入力..."),
      "Durable Objects とは何ですか",
    );
    await userEvent.keyboard("{Enter}");

    expect(calls.map((call) => [call.url, call.body])).toStrictEqual([
      [
        "/api/pdf/p1/selections/s1/chats",
        {
          content: `> ${ANSWER}\n\nDurable Objects とは何ですか`,
          useWebSearch: true,
        },
      ],
    ]);
    // The quote belonged to that one question; the next starts clean
    expect(screen.queryByRole("button", { name: "引用を取り消す" })).toBeNull();
  });

  it("asks about the highlight again once the quote is taken back", async () => {
    const { fetchFn, calls } = streamingFetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { quote } = renderChat({ messages: [ANSWER_MESSAGE] });
    await quote(ANSWER);

    await userEvent.click(screen.getByRole("button", { name: "引用を取り消す" }));

    expect(screen.getByText(SELECTED_TEXT)).toBeVisible();
    await userEvent.type(screen.getByPlaceholderText("質問を入力..."), "もう少し詳しく");
    await userEvent.keyboard("{Enter}");
    expect(calls.map((call) => call.body)).toStrictEqual([
      { content: "もう少し詳しく", useWebSearch: true },
    ]);
  });

  it("drops a quote taken in one conversation when another one is opened", async () => {
    // The quote is a passage of this thread; carrying it into the next one
    // would attach it to a conversation it was never part of
    const { store, quote } = renderChat({ messages: [ANSWER_MESSAGE] });
    await quote(ANSWER);
    expect(screen.getByRole("button", { name: "引用を取り消す" })).toBeVisible();

    act(() => {
      store.set(activeSelectionAtom, { id: "s2", selectedText: OTHER_TEXT, pageNumber: 7 });
    });

    expect(screen.getByText(OTHER_TEXT)).toBeVisible();
    expect(screen.queryByRole("button", { name: "引用を取り消す" })).toBeNull();
  });

  it("stops the answer being streamed when the chat is left", async () => {
    const { store } = renderChat();
    const controller = new AbortController();
    store.set(chatAbortControllerAtom, controller);
    store.set(isStreamingAtom, true);

    await userEvent.click(screen.getByRole("button", { name: "一覧に戻る" }));

    expect(controller.signal.aborted).toBe(true);
    expect(store.get(isStreamingAtom)).toBe(false);
    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
  });

  it("changes the open highlight's colour and note from the head of its conversation", async () => {
    const changes: unknown[] = [];
    renderChat({
      changeHighlight: (pdfId, selectionId, change) => {
        changes.push([pdfId, selectionId, change]);
        return okAsync({ id: selectionId, color: "#42A5F5", note: "状態は外に置く" });
      },
    });
    expect(screen.queryByText("状態は外に置く")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "メモと色" }));
    await userEvent.type(screen.getByRole("textbox", { name: "メモ" }), "状態は外に置く");
    await userEvent.click(screen.getByRole("button", { name: "メモを保存" }));

    expect(changes).toStrictEqual([[BOOK.id, "s1", { note: "状態は外に置く" }]]);
    // Read back out of the book the viewer draws from, so the note is shown
    // under the head the moment the cache has it, and the list has it too.
    expect(await screen.findByText("状態は外に置く")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "一覧に戻る" }));
    expect(screen.getByText("状態は外に置く")).toBeVisible();
  });

  it("leaves the editor behind when another highlight's conversation is opened", async () => {
    const { store } = renderChat();
    await userEvent.click(screen.getByRole("button", { name: "メモと色" }));
    expect(screen.getByRole("group", { name: "メモと色" })).toBeInTheDocument();

    act(() => {
      store.set(activeSelectionAtom, { id: "s2", selectedText: OTHER_TEXT, pageNumber: 7 });
    });

    expect(screen.queryByRole("group", { name: "メモと色" })).toBeNull();
  });

  it("offers no colour or note in a chat about the book, which marks no passage", () => {
    renderChat({ activeSelection: null, session: { id: "sess-1" } });

    expect(screen.queryByRole("button", { name: "メモと色" })).toBeNull();
  });
});
