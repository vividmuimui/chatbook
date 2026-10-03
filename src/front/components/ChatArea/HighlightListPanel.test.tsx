import { describe, it, expect, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { HighlightListPanel, type HighlightListItem } from "./HighlightListPanel";
import { ApiError } from "../../lib/fetcher";
import type { ActiveSelection } from "../../atoms/chatAtom";
import type { UpdateSelectionRequest } from "../../../shared/schemas/selection";

const OLDER: HighlightListItem = {
  id: "01JOLD",
  selectedText: "エッジはサーバーレス実行基盤で、実行単位をまたいでメモリを共有できません。",
  pageNumber: 42,
  color: "#FFEB3B",
  note: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

const MIDDLE: HighlightListItem = {
  id: "01JMID",
  selectedText: "KV は結果整合で、書き込みが伝わるまで数秒かかります。",
  pageNumber: 88,
  color: "#4CAF50",
  note: null,
  createdAt: "2026-08-02T10:00:00.000Z",
};

const NEWER: HighlightListItem = {
  id: "01JNEW",
  selectedText: "Durable Objects は単一のインスタンスに処理を集約します。",
  pageNumber: 7,
  color: "#2196F3",
  note: null,
  createdAt: "2026-08-03T10:00:00.000Z",
};

const ACCEPTS_EVERY_DELETION = () => okAsync(undefined);

interface PanelOverrides {
  onSelect?: (selection: ActiveSelection) => void;
  onDelete?: (selectionId: string) => ResultAsync<void, ApiError>;
  onUpdate?: (selectionId: string, change: UpdateSelectionRequest) => ResultAsync<void, ApiError>;
  /** Opens the conversation about the book itself, which no highlight holds. */
  onOpenBookChat?: () => void;
  /** The narrowed list, when the test is standing in for a search that ran. */
  shown?: HighlightListItem[];
  query?: string;
  onQueryChange?: (query: string) => void;
  onSearch?: () => void;
  /** Whether a search has actually been run, as opposed to merely typed. */
  searched?: boolean;
  searchError?: string;
}

function panel(highlights: HighlightListItem[], overrides: PanelOverrides = {}) {
  return (
    <HighlightListPanel
      highlights={overrides.shown ?? highlights}
      total={highlights.length}
      query={overrides.query ?? ""}
      onQueryChange={overrides.onQueryChange ?? (() => {})}
      onSearch={overrides.onSearch ?? (() => {})}
      searched={overrides.searched ?? false}
      searchError={overrides.searchError}
      onSelect={overrides.onSelect ?? (() => {})}
      onDelete={overrides.onDelete ?? ACCEPTS_EVERY_DELETION}
      onUpdate={overrides.onUpdate ?? (() => okAsync(undefined))}
      onOpenBookChat={overrides.onOpenBookChat ?? (() => {})}
    />
  );
}

function renderPanel(highlights: HighlightListItem[], overrides: PanelOverrides = {}) {
  return render(panel(highlights, overrides));
}

/** The delete button of one row, told apart from the row's own button. */
function deleteButtonOf(highlight: HighlightListItem) {
  const row = screen.getByText(highlight.selectedText).closest("li");
  return within(row as HTMLElement).getByRole("button", { name: /を削除$/ });
}

describe("HighlightListPanel", () => {
  it("shows each highlight with its passage and page, plus how many there are", () => {
    renderPanel([OLDER, NEWER]);

    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
    expect(screen.getByText("42ページ")).toBeInTheDocument();
    expect(screen.getByText(NEWER.selectedText)).toBeInTheDocument();
    expect(screen.getByText("7ページ")).toBeInTheDocument();
  });

  it("lists the most recently created highlight first, whatever order they arrive in", () => {
    renderPanel([NEWER, OLDER, MIDDLE]);

    const passages = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent?.replace(/\d+ページ$/, ""));

    expect(passages).toStrictEqual([NEWER.selectedText, MIDDLE.selectedText, OLDER.selectedText]);
  });

  it("hands the clicked highlight to onSelect so its chat can be opened", async () => {
    const selected: unknown[] = [];
    renderPanel([OLDER, NEWER], { onSelect: (h) => selected.push(h) });

    await userEvent.click(screen.getByText(OLDER.selectedText));

    expect(selected).toStrictEqual([
      { id: OLDER.id, selectedText: OLDER.selectedText, pageNumber: OLDER.pageNumber },
    ]);
  });

  it("tells the reader how to start when the book has no highlights yet", () => {
    renderPanel([]);

    expect(screen.getByText("チャットを開始するには")).toBeInTheDocument();
    expect(screen.getByText("本文のテキストを選択して質問してください")).toBeInTheDocument();
  });

  it("offers the book itself to ask about where there is no passage to pick", async () => {
    const opened = vi.fn();
    renderPanel([], { onOpenBookChat: opened });

    await userEvent.click(screen.getByRole("button", { name: "本について質問する" }));

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("keeps offering the book itself above a list that already has highlights", async () => {
    const opened = vi.fn();
    renderPanel([OLDER, NEWER], { onOpenBookChat: opened });

    await userEvent.click(screen.getByRole("button", { name: "本について質問する" }));

    expect(opened).toHaveBeenCalledTimes(1);
    // The way in is added above the list rather than in place of it.
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
  });

  it("passes what the reader types to whoever runs the search", async () => {
    // The box is controlled by the searcher, so what arrives here is each
    // keystroke against the query it was given rather than a growing string.
    const typed: string[] = [];
    renderPanel([OLDER, MIDDLE, NEWER], { onQueryChange: (q) => typed.push(q) });

    await userEvent.type(screen.getByLabelText("ハイライトを検索"), "結");

    expect(typed).toStrictEqual(["結"]);
  });

  it("searches nothing while the reader is still typing", async () => {
    let searches = 0;
    renderPanel([OLDER, MIDDLE, NEWER], { onSearch: () => (searches += 1) });

    await userEvent.type(screen.getByLabelText("ハイライトを検索"), "結果整合");

    expect(searches).toBe(0);
    expect(screen.getByRole("button", { name: "検索" })).toBeInTheDocument();
  });

  it("runs the search when the button is pressed", async () => {
    let searches = 0;
    renderPanel([OLDER, MIDDLE, NEWER], { query: "結果整合", onSearch: () => (searches += 1) });

    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(searches).toBe(1);
  });

  it("runs the search on Enter, so the box can be used without the mouse", async () => {
    let searches = 0;
    renderPanel([OLDER, MIDDLE, NEWER], { query: "結果整合", onSearch: () => (searches += 1) });

    await userEvent.type(screen.getByLabelText("ハイライトを検索"), "{Enter}");

    expect(searches).toBe(1);
  });

  it("leaves the Enter that confirms a Japanese word to the IME", async () => {
    // Enter mid-conversion picks the candidate; searching there would run on
    // half a word every time a phrase is confirmed.
    let searches = 0;
    renderPanel([OLDER, MIDDLE, NEWER], { query: "結果整合", onSearch: () => (searches += 1) });
    const box = screen.getByLabelText("ハイライトを検索");

    box.focus();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true, keyCode: 229 });

    expect(searches).toBe(0);
    expect(box).toHaveFocus();
  });

  it("counts the whole book until the search has actually been run", () => {
    // Typing is not searching: the header must not claim a narrowing that the
    // list has not been through yet.
    renderPanel([OLDER, MIDDLE, NEWER], { query: "結果整合" });

    expect(screen.getByText("ハイライト 3件")).toBeInTheDocument();
  });

  it("counts what the search left against the whole book", () => {
    renderPanel([OLDER, MIDDLE, NEWER], { query: "結果整合", shown: [MIDDLE], searched: true });

    expect(screen.getByText("ハイライト 3件中 1件")).toBeInTheDocument();
    expect(screen.getByText(MIDDLE.selectedText)).toBeInTheDocument();
    expect(screen.queryByText(OLDER.selectedText)).not.toBeInTheDocument();
  });

  it("counts the whole book again once nothing is being searched for", () => {
    renderPanel([OLDER, MIDDLE, NEWER], { query: "" });

    expect(screen.getByText("ハイライト 3件")).toBeInTheDocument();
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
    expect(screen.getByText(MIDDLE.selectedText)).toBeInTheDocument();
    expect(screen.getByText(NEWER.selectedText)).toBeInTheDocument();
  });

  it("says nothing matched but keeps the box, so the search can be widened again", () => {
    renderPanel([OLDER, MIDDLE, NEWER], { query: "みつからない語", shown: [], searched: true });

    expect(screen.getByText("一致するハイライトがありません")).toBeInTheDocument();
    expect(screen.getByText("ハイライト 3件中 0件")).toBeInTheDocument();
    expect(screen.getByLabelText("ハイライトを検索")).toHaveValue("みつからない語");
  });

  it("says why the search did not happen, without hiding the highlights over it", () => {
    renderPanel([OLDER, MIDDLE, NEWER], {
      query: "結果整合",
      searchError: "Unexpected server error",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "検索に失敗しました: Unexpected server error",
    );
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
  });

  it("asks before deleting, saying the chat goes with the highlight", async () => {
    renderPanel([OLDER]);

    await userEvent.click(deleteButtonOf(OLDER));

    expect(screen.getByRole("alertdialog", { name: "ハイライトの削除" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "このハイライトを削除しますか？このハイライトのチャット履歴も削除されます。",
      ),
    ).toBeInTheDocument();
  });

  it("deletes the highlight whose removal the reader confirmed", async () => {
    const deleted: string[] = [];
    renderPanel([OLDER, NEWER], {
      onDelete: (id) => {
        deleted.push(id);
        return okAsync(undefined);
      },
    });

    await userEvent.click(deleteButtonOf(OLDER));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(deleted).toStrictEqual([OLDER.id]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("deletes nothing when the reader cancels", async () => {
    const deleted: string[] = [];
    renderPanel([OLDER], {
      onDelete: (id) => {
        deleted.push(id);
        return okAsync(undefined);
      },
    });

    await userEvent.click(deleteButtonOf(OLDER));
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(deleted).toStrictEqual([]);
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the highlight and says why when the server refuses to delete it", async () => {
    renderPanel([OLDER], {
      onDelete: () => errAsync(new ApiError("Unexpected server error", "INTERNAL_ERROR", 500)),
    });

    await userEvent.click(deleteButtonOf(OLDER));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(
      await screen.findByText("削除に失敗しました: Unexpected server error"),
    ).toBeInTheDocument();
    expect(screen.getByText(OLDER.selectedText)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("opens no chat when the reader reaches for a highlight's delete button", async () => {
    const selected: unknown[] = [];
    renderPanel([OLDER], { onSelect: (h) => selected.push(h) });

    await userEvent.click(deleteButtonOf(OLDER));

    expect(screen.getByRole("alertdialog", { name: "ハイライトの削除" })).toBeInTheDocument();
    expect(selected).toStrictEqual([]);
  });

  it("names the passage in each delete button, cut short when the passage runs long", () => {
    const short: HighlightListItem = { ...OLDER, id: "01JSHORT", selectedText: "短い一文。" };
    renderPanel([OLDER, short]);

    expect(
      screen.getByRole("button", { name: `「${OLDER.selectedText.slice(0, 20)}…」を削除` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "「短い一文。」を削除" })).toBeInTheDocument();
  });

  it("clears the last failure once the next deletion goes through", async () => {
    let refuse = true;
    renderPanel([OLDER, NEWER], {
      onDelete: () =>
        refuse
          ? errAsync(new ApiError("Unexpected server error", "INTERNAL_ERROR", 500))
          : okAsync(undefined),
    });
    await userEvent.click(deleteButtonOf(OLDER));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    refuse = false;
    await userEvent.click(deleteButtonOf(NEWER));
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("ハイライト 2件")).toBeInTheDocument();
  });

  describe("colours and notes", () => {
    const NOTED: HighlightListItem = {
      ...MIDDLE,
      color: "#EC407A",
      note: "設計レビューで引用する",
    };

    function editButtonOf(highlight: HighlightListItem) {
      const row = screen.getByText(highlight.selectedText).closest("li");
      return within(row as HTMLElement).getByRole("button", { name: /のメモと色を変える$/ });
    }

    it("shows a note under its passage, said to be a note, and nothing under one without", () => {
      renderPanel([OLDER, NOTED]);

      const noted = screen.getByText(NOTED.selectedText).closest("li") as HTMLElement;
      expect(within(noted).getByText("設計レビューで引用する")).toBeInTheDocument();
      expect(within(noted).getByRole("button", { name: /メモ:\s*設計レビューで引用する/ })).toBe(
        within(noted).getAllByRole("button")[0],
      );
      const plain = screen.getByText(OLDER.selectedText).closest("li") as HTMLElement;
      expect(plain.textContent).not.toContain("メモ:");
    });

    it("changes a highlight's colour the moment a swatch is pressed", async () => {
      const changes: unknown[] = [];
      renderPanel([NOTED], {
        onUpdate: (id, change) => {
          changes.push([id, change]);
          return okAsync(undefined);
        },
      });

      await userEvent.click(editButtonOf(NOTED));
      expect(screen.getByRole("button", { name: "ピンクに変える" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await userEvent.click(screen.getByRole("button", { name: "オレンジに変える" }));

      expect(changes).toStrictEqual([[NOTED.id, { color: "#FF9800" }]]);
    });

    it("rewrites a note on saving it, and closes the editor once it is kept", async () => {
      const changes: unknown[] = [];
      renderPanel([NOTED], {
        onUpdate: (id, change) => {
          changes.push([id, change]);
          return okAsync(undefined);
        },
      });
      await userEvent.click(editButtonOf(NOTED));
      const field = screen.getByRole("textbox", { name: "メモ" });
      expect(field).toHaveValue(NOTED.note);

      await userEvent.clear(field);
      await userEvent.type(field, "  章の要約に使う  ");
      await userEvent.click(screen.getByRole("button", { name: "メモを保存" }));

      expect(changes).toStrictEqual([[NOTED.id, { note: "章の要約に使う" }]]);
      await waitFor(() => expect(screen.queryByRole("group", { name: "メモと色" })).toBeNull());
    });

    it("takes the note away when it is emptied and saved", async () => {
      const changes: unknown[] = [];
      renderPanel([NOTED], {
        onUpdate: (id, change) => {
          changes.push([id, change]);
          return okAsync(undefined);
        },
      });
      await userEvent.click(editButtonOf(NOTED));

      await userEvent.clear(screen.getByRole("textbox", { name: "メモ" }));
      await userEvent.click(screen.getByRole("button", { name: "メモを保存" }));

      expect(changes).toStrictEqual([[NOTED.id, { note: null }]]);
    });

    it("says a change was refused inside the editor, and keeps what was typed", async () => {
      renderPanel([OLDER], {
        onUpdate: () => errAsync(new ApiError("Selection not found", "SELECTION_NOT_FOUND", 404)),
      });
      await userEvent.click(editButtonOf(OLDER));
      const field = screen.getByRole("textbox", { name: "メモ" });

      await userEvent.type(field, "書きかけ");
      await userEvent.click(screen.getByRole("button", { name: "メモを保存" }));

      const editor = screen.getByRole("group", { name: "メモと色" });
      expect(await within(editor).findByRole("alert")).toHaveTextContent(
        "変更できませんでした: Selection not found",
      );
      expect(field).toHaveValue("書きかけ");
    });

    it("opens one editor at a time", async () => {
      renderPanel([OLDER, NOTED]);

      await userEvent.click(editButtonOf(OLDER));
      await userEvent.click(editButtonOf(NOTED));

      expect(screen.getAllByRole("group", { name: "メモと色" })).toHaveLength(1);
      expect(screen.getByRole("textbox", { name: "メモ" })).toHaveValue(NOTED.note);
    });
  });
});
