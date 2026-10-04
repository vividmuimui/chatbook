import { useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  chatMessagesAtom,
  streamingContentAtom,
  isStreamingAtom,
  activeSelectionAtom,
  activeSessionAtom,
  chatErrorAtom,
  abortChatStreamAtom,
  selectionDeletedAtom,
  sessionDeletedAtom,
  sessionStartedAtom,
  chatScopeAtom,
  chatFaceAtom,
  chatListTabAtom,
  type ActiveSelection,
  type ChatListTab,
} from "../../atoms/chatAtom";
import type { BookDetail } from "../../../shared/schemas/book";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { ChatScopeMenu } from "./ChatScopeMenu";
import { ChatListPanel } from "./ChatListPanel";
import { HighlightListPanel } from "./HighlightListPanel";
import { HighlightEditor } from "./HighlightEditor";
import { SessionTitle } from "./SessionTitle";
import { useWebSearchAtom } from "../../atoms/settingsAtom";
import { useChatStream } from "../../hooks/useChatStream";
import { useChapters } from "../../hooks/useChapters";
import { useChatList, type ChatListRequests } from "../../hooks/useChatList";
import {
  useHighlights,
  type DeleteHighlight,
  type UpdateHighlight,
} from "../../hooks/useHighlights";
import { useHighlightSearch, type SearchSelections } from "../../hooks/useHighlightSearch";
import { formatQuotedQuestion } from "../../lib/quotedQuestion";
import { scopeRanges } from "../../lib/chatScope";
import { NEW_CHAT_TITLE, sessionTitle } from "../../lib/chatList";
import type { ReadChatQuote } from "../../lib/chatQuoteSelection";

interface ChatAreaProps {
  /** The book being read, or nothing while it is still being read in. */
  book: BookDetail | undefined;
  /** Why the book could not be read, if it could not. */
  bookError?: Error;
  /** Opens a highlight's conversation, turning to its page. */
  onSelectionClick: (selection: ActiveSelection) => void;
  /** Turns to a highlight's page and leaves the panel as it is. */
  onGoToHighlight: (selection: ActiveSelection) => void;
  /** Opens one of the book's own sessions, with what was said in it. */
  onOpenSession: (sessionId: string) => void;
  /** Starts a chat about the book with nothing asked in it yet. */
  onNewChat: () => void;
  /** Reads what a drag over the thread selected; injectable for tests. */
  readQuote?: ReadChatQuote;
  /** Removes a highlight; injectable so tests can record or refuse one. */
  deleteHighlight?: DeleteHighlight;
  /** Recolours a highlight or rewrites its note; injectable for the same reason. */
  changeHighlight?: UpdateHighlight;
  /** Searches the highlights and their chats; injectable for the same reason. */
  searchHighlights?: SearchSelections;
  /** The chat list's reads and writes; injectable for the same reason. */
  chatRequests?: ChatListRequests;
}

/** A failure worded for the reader, in the one place the panel shows them. */
function ChatErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="m-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
      {message}
    </p>
  );
}

const TABS: { tab: ChatListTab; label: string }[] = [
  { tab: "chats", label: "チャット" },
  { tab: "highlights", label: "ハイライト" },
];

export function ChatArea({
  book,
  bookError,
  onSelectionClick,
  onGoToHighlight,
  onOpenSession,
  onNewChat,
  readQuote,
  deleteHighlight,
  changeHighlight,
  searchHighlights,
  chatRequests,
}: ChatAreaProps) {
  const [activeSelection, setActiveSelection] = useAtom(activeSelectionAtom);
  const [activeSession, setActiveSession] = useAtom(activeSessionAtom);
  const [scope, setScope] = useAtom(chatScopeAtom);
  const [tab, setTab] = useAtom(chatListTabAtom);
  const { data: chapterList, error: chaptersError } = useChapters(book?.id);
  const face = useAtomValue(chatFaceAtom);
  const { highlights, removeHighlight, updateHighlight } = useHighlights(
    book?.id,
    undefined,
    deleteHighlight,
    changeHighlight,
  );
  const { query, setQuery, submit, matchedIds, searchError } = useHighlightSearch(
    book?.id,
    searchHighlights,
  );
  const chatList = useChatList(book?.id, chatRequests);
  const selectionDeleted = useSetAtom(selectionDeletedAtom);
  const sessionDeleted = useSetAtom(sessionDeletedAtom);
  const sessionStarted = useSetAtom(sessionStartedAtom);
  const messages = useAtomValue(chatMessagesAtom);
  const streamingContent = useAtomValue(streamingContentAtom);
  const isStreaming = useAtomValue(isStreamingAtom);
  const [chatError, setChatError] = useAtom(chatErrorAtom);
  const useWebSearch = useAtomValue(useWebSearchAtom);
  const abortChatStream = useSetAtom(abortChatStreamAtom);

  const { sendMessage } = useChatStream();

  /** A passage of this thread the next question is about, if one was picked. */
  const [quote, setQuote] = useState<string | null>(null);
  /** Whether a new chat's session is being made for its first question. */
  const [starting, setStarting] = useState(false);

  /** How much was said about each highlight, for the list's chat buttons. */
  const chatCounts = useMemo(
    () =>
      new Map(
        chatList.chats.flatMap((chat) =>
          chat.kind === "highlight" ? [[chat.id, chat.messageCount] as const] : [],
        ),
      ),
    [chatList.chats],
  );

  // The highlight is the passage the question is about, and it is the reader's
  // to leave behind; a chat about the book has none. Resolved here rather than
  // read off `activeSelection` below, so the branches agree with the face.
  const selection = face === "highlight" ? activeSelection : null;
  const session = face === "book" ? activeSession : null;
  /** Which thread a quote was taken out of, for the reset below. */
  const thread = session !== null ? `session:${session.id ?? "new"}` : (selection?.id ?? null);

  // A quote is a passage of the conversation it was taken from, so opening
  // another one leaves it behind. Adjusted during the render that brings the
  // new thread in, so the input never shows the old quote under it.
  /** Whether the open highlight's colour and note are up for changing. */
  const [editing, setEditing] = useState(false);
  const [quotedFrom, setQuotedFrom] = useState(thread);
  if (thread !== quotedFrom) {
    setQuotedFrom(thread);
    setQuote(null);
    // The editor belongs to the highlight it was opened on, like the quote.
    setEditing(false);
  }
  /**
   * The open highlight as stored, colour and note included. Read from the book
   * rather than from `activeSelection`, which only names the passage: a change
   * made here, or in the list, is then on screen the moment the cache has it.
   */
  const marked = selection === null ? undefined : highlights.find((h) => h.id === selection.id);

  /** The open session's row in the chat list, for its name. */
  const listed =
    session?.id == null
      ? undefined
      : chatList.chats.find((chat) => chat.kind === "book" && chat.id === session.id);
  const openTitle =
    listed?.kind === "book" ? sessionTitle(listed) : session?.id == null ? NEW_CHAT_TITLE : "";

  // The chapters the session's pages are, for the menu. Found by their pages,
  // so a session reopened before the chapter list arrived picks them out once
  // it has; pages that are no chapter any more are the whole book again.
  const chapters = chapterList?.chapters ?? [];
  const pickedChapters = chapters.filter((chapter) =>
    scope.some(
      (range) => range.startPage === chapter.startPage && range.endPage === chapter.endPage,
    ),
  );

  const handleSend = async (content: string) => {
    if (!book || face === "list") return;
    // The quote rides inside the message: the thread is stored as content and
    // nothing beside it would survive a reload or reach the model.
    const question = quote === null ? content : formatQuotedQuestion(quote, content);
    setQuote(null);

    if (selection !== null) {
      await sendMessage(book.id, { selectionId: selection.id }, question, useWebSearch);
      return;
    }
    if (session === null) return;

    // A new chat is made on the server by its first question, and not before:
    // one opened and left empty leaves nothing behind in the list.
    let sessionId = session.id;
    if (sessionId === null) {
      setStarting(true);
      const created = await chatList.startSession(book.id);
      setStarting(false);
      if (created.isErr()) {
        setChatError(`チャットを始められませんでした: ${created.error.message}`);
        return;
      }
      // The reader left this new chat while it was being made: the question
      // was for a chat no longer on screen, and is not asked in another.
      if (!sessionStarted(created.value.id)) return;
      sessionId = created.value.id;
    }

    // The pages it is aimed at ride with the question, and the session keeps
    // them for the next time it is opened. Until the chapter list has arrived
    // the session's own ranges are what there is to send.
    const ranges = chapterList
      ? scopeRanges(pickedChapters, book.pageCount)
      : scope.length > 0
        ? scope
        : scopeRanges([], book.pageCount);
    await sendMessage(book.id, { sessionId }, question, useWebSearch, { scope: ranges });
  };

  const backToList = () => {
    abortChatStream();
    if (face === "book") setActiveSession(null);
    else setActiveSelection(null);
  };

  if (bookError && !book) {
    // The highlights are read out of the book, so a book that did not load has
    // no list to show — and an empty list here reads as "nothing marked yet".
    // A book already in hand still wins: a failed re-read of it changes nothing
    // about the highlights on screen.
    return (
      <div className="flex h-full flex-col justify-center bg-white">
        <ChatErrorNotice message={`ハイライトを読み込めませんでした: ${bookError.message}`} />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <p className="text-gray-400 text-sm">PDFを開いてテキストを選択してください</p>
      </div>
    );
  }

  if (face === "list") {
    return (
      <div className="flex h-full flex-col bg-white">
        {/* Two lists with two ways in, side by side so either is one tap from
            the other: what was asked, and what was marked. */}
        <div
          role="tablist"
          aria-label="チャットとハイライト"
          className="flex shrink-0 border-b border-gray-200"
        >
          {TABS.map(({ tab: value, label }) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`chat-tab-${value}`}
              aria-selected={tab === value}
              aria-controls="chat-tabpanel"
              onClick={() => setTab(value)}
              className={`flex-1 cursor-pointer border-b-2 px-4 py-2.5 text-sm ${
                tab === value
                  ? "border-blue-600 font-medium text-blue-700"
                  : "border-transparent text-gray-500 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="chat-tabpanel"
          aria-labelledby={`chat-tab-${tab}`}
          className="min-h-0 flex-1"
        >
          {tab === "chats" ? (
            <ChatListPanel
              chats={chatList.chats}
              loaded={chatList.loaded}
              error={chatList.error}
              pageCount={book.pageCount}
              onNewChat={onNewChat}
              onOpenSession={onOpenSession}
              onOpenHighlightChat={(chat) =>
                onSelectionClick({
                  id: chat.id,
                  selectedText: chat.selectedText,
                  pageNumber: chat.pageNumber,
                })
              }
              // Leaving the chat is the store's to decide once the server
              // answers, as with a highlight.
              onDeleteSession={(id) =>
                chatList.deleteSession(book.id, id).map(() => sessionDeleted(id))
              }
            />
          ) : (
            <HighlightListPanel
              highlights={matchedIds ? highlights.filter((h) => matchedIds.has(h.id)) : highlights}
              total={highlights.length}
              query={query}
              onQueryChange={setQuery}
              onSearch={submit}
              searched={matchedIds !== null}
              searchError={searchError}
              onSelect={onGoToHighlight}
              onOpenChat={onSelectionClick}
              chatCounts={chatCounts}
              // Leaving the chat is the store's to decide once the server answers:
              // the reader can have opened one while the request was in flight.
              // The chat list loses the highlight's conversation with it.
              onDelete={(id) =>
                removeHighlight(book.id, id).map(() => {
                  selectionDeleted(id);
                  chatList.refresh();
                })
              }
              onUpdate={(id, change) =>
                updateHighlight(book.id, id, change).map(() => chatList.refresh())
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center px-2 py-2 border-b border-gray-200 shrink-0">
        <button
          type="button"
          onClick={backToList}
          className="cursor-pointer rounded px-2 py-1 text-sm text-blue-600 hover:bg-gray-50"
        >
          <span aria-hidden="true">←</span> 一覧に戻る
        </button>
        {marked && (
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
            className="ml-auto flex h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: marked.color }}
              className="h-3 w-3 shrink-0 rounded-full"
            />
            メモと色
          </button>
        )}
        {session !== null && (
          <ChatScopeMenu
            chapters={chapters}
            chaptersError={chaptersError as Error | undefined}
            pageCount={book.pageCount}
            scope={pickedChapters}
            onChange={(picked) =>
              setScope(picked.map(({ startPage, endPage }) => ({ startPage, endPage })))
            }
          />
        )}
      </div>
      {session !== null && (
        <SessionTitle
          title={openTitle}
          // Only a session the server has can be named; a new chat is called
          // by its first question once it has one.
          onRename={
            session.id === null
              ? undefined
              : (title) => chatList.renameSession(book.id, session.id as string, title)
          }
        />
      )}
      {marked &&
        (editing ? (
          <HighlightEditor
            color={marked.color}
            note={marked.note}
            onChange={(change) => updateHighlight(book.id, marked.id, change)}
            onClose={() => setEditing(false)}
          />
        ) : (
          marked.note !== null && (
            // The reader's own words about the passage, above what the AI said
            // about it. Clamped, so a long note does not push the thread away.
            <p
              style={{ borderColor: marked.color }}
              className="mx-4 mt-2 line-clamp-3 shrink-0 whitespace-pre-wrap border-l-4 pl-2 text-xs text-gray-600"
            >
              <span className="sr-only">メモ: </span>
              {marked.note}
            </p>
          )
        ))}
      <ChatMessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        onQuote={setQuote}
        readQuote={readQuote}
      />
      {chatError !== null && <ChatErrorNotice message={chatError} />}
      <ChatInput
        onSend={handleSend}
        disabled={isStreaming || starting}
        quotedText={selection === null ? quote : (quote ?? selection.selectedText)}
        onClearQuote={quote === null ? undefined : () => setQuote(null)}
      />
    </div>
  );
}
