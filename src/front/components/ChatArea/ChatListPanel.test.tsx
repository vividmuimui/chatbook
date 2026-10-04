import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { ChatListPanel } from "./ChatListPanel";
import { ApiError } from "../../lib/fetcher";
import type { ChatSummary } from "../../../shared/schemas/chat";

const NOW = new Date(2026, 9, 4, 18, 0);

const SUMMARY: ChatSummary = {
  kind: "book",
  id: "s-summary",
  title: null,
  firstQuestion: "この本を要約して",
  scope: [{ startPage: 1, endPage: 12 }],
  messageCount: 2,
  lastMessage: { role: "assistant", content: "この本は\nエッジについての本です。" },
  updatedAt: new Date(2026, 9, 4, 9, 30).toISOString(),
};

const CHAPTER: ChatSummary = {
  kind: "book",
  id: "s-chapter",
  title: "第2章の論点",
  firstQuestion: "第2章は?",
  scope: [{ startPage: 5, endPage: 8 }],
  messageCount: 1,
  lastMessage: { role: "user", content: "第2章は?" },
  updatedAt: new Date(2026, 8, 30, 9, 30).toISOString(),
};

const PASSAGE = "Durable Objects は単一のインスタンスに処理を集約します。";

const HIGHLIGHT: ChatSummary = {
  kind: "highlight",
  id: "h-1",
  selectedText: PASSAGE,
  pageNumber: 7,
  color: "#42A5F5",
  messageCount: 2,
  lastMessage: { role: "assistant", content: "そのとおりです。" },
  updatedAt: new Date(2026, 8, 29, 9, 30).toISOString(),
};

interface Overrides {
  chats?: ChatSummary[];
  loaded?: boolean;
  error?: Error;
  onNewChat?: () => void;
  onOpenSession?: (id: string) => void;
  onOpenHighlightChat?: (chat: ChatSummary) => void;
  onDeleteSession?: (id: string) => ResultAsync<void, ApiError>;
}

function renderList(overrides: Overrides = {}) {
  return render(
    <ChatListPanel
      chats={overrides.chats ?? [SUMMARY, CHAPTER, HIGHLIGHT]}
      loaded={overrides.loaded ?? true}
      error={overrides.error}
      pageCount={12}
      onNewChat={overrides.onNewChat ?? (() => {})}
      onOpenSession={overrides.onOpenSession ?? (() => {})}
      onOpenHighlightChat={overrides.onOpenHighlightChat ?? (() => {})}
      onDeleteSession={overrides.onDeleteSession ?? (() => okAsync(undefined))}
      now={NOW}
    />,
  );
}

describe("ChatListPanel", () => {
  it("lists every conversation with what kind it is, its name, how it ended and when", () => {
    renderList();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("本全体");
    expect(rows[0]).toHaveTextContent("この本を要約して");
    expect(rows[0]).toHaveTextContent("AI: この本は エッジについての本です。");
    expect(rows[0]).toHaveTextContent("09:30");
    expect(rows[1]).toHaveTextContent("範囲");
    expect(rows[1]).toHaveTextContent("第2章の論点");
    expect(rows[1]).toHaveTextContent("9/30");
    expect(rows[2]).toHaveTextContent("ハイライト");
    // A passage is cut to 30 characters, like an untitled session's question.
    expect(rows[2]).toHaveTextContent(`${PASSAGE.slice(0, 30)}…`);
  });

  it("opens a session, or a highlight's conversation, from its row", async () => {
    const sessions: string[] = [];
    const highlights: ChatSummary[] = [];
    renderList({
      onOpenSession: (id) => sessions.push(id),
      onOpenHighlightChat: (chat) => highlights.push(chat),
    });

    await userEvent.click(screen.getByText("第2章の論点"));
    await userEvent.click(screen.getByText(/^Durable Objects/));

    expect(sessions).toStrictEqual(["s-chapter"]);
    expect(highlights).toStrictEqual([HIGHLIGHT]);
  });

  it("starts a new chat from the top of the list", async () => {
    const started = vi.fn();
    renderList({ onNewChat: started });

    await userEvent.click(screen.getByRole("button", { name: "新しいチャット" }));

    expect(started).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing yet, and still offers a new chat, for a book nobody asked about", () => {
    renderList({ chats: [] });

    expect(screen.getByText("チャットはまだありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新しいチャット" })).toBeInTheDocument();
  });

  it("calls a session nothing was asked in a new chat", () => {
    renderList({
      chats: [{ ...SUMMARY, firstQuestion: null, lastMessage: null, messageCount: 0 }],
    });

    const [row] = screen.getAllByRole("listitem");
    expect(row).toHaveTextContent("新しいチャット");
    expect(row).toHaveTextContent("まだ質問していません");
  });

  it("deletes a session once the reader confirms, and offers no delete for a highlight's", async () => {
    const deleted: string[] = [];
    renderList({
      onDeleteSession: (id) => {
        deleted.push(id);
        return okAsync(undefined);
      },
    });

    expect(
      within(screen.getAllByRole("listitem")[2]).queryByRole("button", { name: /を削除$/ }),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "チャット「第2章の論点」を削除" }));
    const dialog = screen.getByRole("alertdialog", { name: "チャットの削除" });
    expect(dialog).toHaveTextContent("チャット「第2章の論点」を削除しますか？");
    await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(deleted).toStrictEqual(["s-chapter"]);
  });

  it("says why a session could not be deleted", async () => {
    renderList({
      onDeleteSession: () =>
        errAsync(new ApiError("Unexpected server error", "INTERNAL_ERROR", 500)),
    });

    await userEvent.click(screen.getByRole("button", { name: "チャット「第2章の論点」を削除" }));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "削除に失敗しました: Unexpected server error",
    );
  });

  it("says the list could not be read, rather than that there is nothing in it", () => {
    renderList({ chats: [], loaded: false, error: new Error("boom") });

    expect(screen.getByRole("alert")).toHaveTextContent("チャット一覧を読み込めませんでした: boom");
    expect(screen.queryByText("チャットはまだありません")).toBeNull();
  });
});
