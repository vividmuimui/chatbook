import { useState } from "react";
import type { ResultAsync } from "neverthrow";
import type { ApiError } from "../../lib/fetcher";
import { chatKind, chatTimeLabel, sessionTitle, type ChatKind } from "../../lib/chatList";
import type { ChatSummary } from "../../../shared/schemas/chat";
import { ConfirmDialog } from "../ConfirmDialog";

type HighlightChat = Extract<ChatSummary, { kind: "highlight" }>;

interface ChatListPanelProps {
  /** Every conversation the book holds, last talked in first. */
  chats: ChatSummary[];
  /** Whether the list has arrived, so an empty one can say it is empty. */
  loaded: boolean;
  /** Why the list could not be read, if it could not. */
  error?: Error;
  /** The pages the book runs to, to tell a question about all of it from one about some. */
  pageCount: number;
  /** Starts a chat about the book with nothing asked in it yet. */
  onNewChat: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenHighlightChat: (chat: HighlightChat) => void;
  /** Deletes a session and what was said in it; its failure comes back in the value. */
  onDeleteSession: (sessionId: string) => ResultAsync<void, ApiError>;
  /** Today, for how a time is written; injectable so a test can pin it. */
  now?: Date;
}

const KIND_CLASS: Record<ChatKind, string> = {
  本全体: "bg-blue-50 text-blue-700",
  範囲: "bg-emerald-50 text-emerald-700",
  ハイライト: "bg-amber-50 text-amber-800",
};

/** Enough of a passage to name the conversation hanging off it. */
function passageTitle(passage: string): string {
  return passage.length <= 30 ? passage : `${passage.slice(0, 30)}…`;
}

/** What a row says a conversation ended on, or that nothing was asked in it. */
function lastLine(chat: ChatSummary): string {
  if (chat.lastMessage === null) return "まだ質問していません";
  const said = chat.lastMessage.content.replace(/\s+/g, " ").trim();
  return chat.lastMessage.role === "assistant" ? `AI: ${said}` : said;
}

/**
 * Every conversation the book holds, in one list: the chats about the book
 * itself — as many as the reader started — and the highlights something was
 * asked about.
 *
 * The highlights are here as well as in their own list because this is where
 * a reader looks for "what did I ask", which is not the same question as "what
 * did I mark". A highlight that was only coloured has nothing to read, so it
 * is only in the other one.
 *
 * Only a chat about the book can be deleted from here: a highlight's
 * conversation goes with the highlight, which is the highlight list's to
 * delete.
 */
export function ChatListPanel({
  chats,
  loaded,
  error,
  pageCount,
  onNewChat,
  onOpenSession,
  onOpenHighlightChat,
  onDeleteSession,
  now = new Date(),
}: ChatListPanelProps) {
  const [pendingDeletion, setPendingDeletion] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const removeSession = async (session: { id: string }) => {
    setActionError(null);
    setPendingDeletion(null);
    const removal = await onDeleteSession(session.id);
    // Lost if the reader opened a chat while this was in flight, for the same
    // reason as a highlight's: the list is gone by then. The session is still
    // in it when they come back, and can be deleted again.
    if (removal.isErr()) setActionError(`削除に失敗しました: ${removal.error.message}`);
  };

  const failure =
    actionError ?? (error ? `チャット一覧を読み込めませんでした: ${error.message}` : null);

  return (
    <div className="flex h-full flex-col bg-white">
      <button
        type="button"
        onClick={onNewChat}
        className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-gray-200 px-4 py-3 text-left text-sm font-medium text-blue-600 hover:bg-gray-50"
      >
        <span aria-hidden="true">＋</span>
        新しいチャット
      </button>
      {failure !== null && (
        <p role="alert" className="m-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
          {failure}
        </p>
      )}
      {loaded && chats.length === 0 ? (
        <div className="flex-1 px-4 py-6 text-center">
          <p className="mb-1 text-sm font-medium text-gray-500">チャットはまだありません</p>
          <p className="text-sm text-gray-400">
            「新しいチャット」で本全体や章について質問するか、本文を選択して質問してください
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {chats.map((chat) => {
            const kind = chatKind(chat, pageCount);
            const title =
              chat.kind === "book" ? sessionTitle(chat) : passageTitle(chat.selectedText);
            return (
              <li key={`${chat.kind}:${chat.id}`} className="relative">
                <button
                  type="button"
                  onClick={() =>
                    chat.kind === "book" ? onOpenSession(chat.id) : onOpenHighlightChat(chat)
                  }
                  className={`block w-full cursor-pointer border-b border-gray-100 py-3 pl-4 text-left hover:bg-gray-50 ${
                    chat.kind === "book" ? "pr-14" : "pr-4"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_CLASS[kind]}`}
                    >
                      {kind}
                    </span>
                    {chat.kind === "highlight" && (
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: chat.color }}
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{title}</span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {chatTimeLabel(chat.updatedAt, now)}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-gray-500">
                    {lastLine(chat)}
                  </span>
                </button>
                {chat.kind === "book" && (
                  <button
                    type="button"
                    aria-label={`チャット「${title}」を削除`}
                    onClick={() => setPendingDeletion({ id: chat.id, title })}
                    // 44px square: the same list is what a finger gets in the sheet.
                    className="absolute right-1 top-1 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="h-4 w-4"
                    >
                      <path d="M6 6l8 8M14 6l-8 8" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingDeletion && (
        <ConfirmDialog
          message={`チャット「${pendingDeletion.title}」を削除しますか？このチャットのやりとりはすべて削除されます。`}
          dialogLabel="チャットの削除"
          confirmLabel="削除する"
          onConfirm={() => removeSession(pendingDeletion)}
          onCancel={() => setPendingDeletion(null)}
        />
      )}
    </div>
  );
}
