import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { SettingsMenu } from "./SettingsMenu";
import { useWebSearchAtom, keybindingModeAtom } from "../atoms/settingsAtom";
import { ApiError } from "../lib/fetcher";
import type { SessionEnded } from "../../shared/schemas/auth";
import type { KeybindingMode } from "../lib/keybindings";
import { SwrTestCache } from "../../test/swrTestCache";
import { SERVER_CONFIG_KEY } from "../hooks/useServerConfig";
import { bookKey } from "../hooks/useBook";
import type { SavePageDirection } from "../hooks/usePageDirection";
import type { BookDetail, PageDirection } from "../../shared/schemas/book";

const BOOK: BookDetail = {
  id: "book-1",
  fileName: "tategaki.pdf",
  format: "pdf",
  pageCount: 12,
  hasThumbnail: false,
  hasOutline: false,
  pageDirection: "ltr",
  selections: [],
  readingState: null,
};

/** The menu as the reader shows it, over an open book. */
function renderMenuOverBook(
  savePageDirection: SavePageDirection,
  pageDirection: PageDirection = "ltr",
  mode: KeybindingMode = "vim",
) {
  const store = createStore();
  store.set(keybindingModeAtom, mode);
  render(
    <SwrTestCache
      seed={{
        [SERVER_CONFIG_KEY]: { webSearchAvailable: true },
        [bookKey(BOOK.id)]: { ...BOOK, pageDirection },
      }}
    >
      <Provider store={store}>
        <SettingsMenu pdfId={BOOK.id} savePageDirection={savePageDirection} />
      </Provider>
    </SwrTestCache>,
  );
}

function renderMenu(
  mode: KeybindingMode = "vim",
  endSession?: () => ResultAsync<SessionEnded, ApiError>,
  webSearchAvailable = true,
) {
  const store = createStore();
  store.set(keybindingModeAtom, mode);
  render(
    <SwrTestCache seed={{ [SERVER_CONFIG_KEY]: { webSearchAvailable } }}>
      <Provider store={store}>
        <SettingsMenu endSession={endSession} />
      </Provider>
    </SwrTestCache>,
  );
  return store;
}

describe("SettingsMenu's page direction", () => {
  it("offers the way the book's pages turn, as the book says they do", async () => {
    renderMenuOverBook(() => okAsync("rtl"));
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    expect(screen.getByRole("radio", { name: "左開き" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "右開き" })).not.toBeChecked();
  });

  it("turns the book the other way, and says what ← does now", async () => {
    const asked: [string, PageDirection][] = [];
    renderMenuOverBook((pdfId, direction) => {
      asked.push([pdfId, direction]);
      return okAsync(direction);
    });
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("radio", { name: "右開き" }));

    expect(asked).toStrictEqual([[BOOK.id, "rtl"]]);
    expect(await screen.findByRole("radio", { name: "右開き" })).toBeChecked();
    expect(describedKey("←/→")).toBe("次 / 前のページ");
  });

  it("says why the book could not be turned the other way, and leaves it as it was", async () => {
    renderMenuOverBook(() =>
      errAsync(new ApiError("Failed to fetch", "NETWORK_ERROR", 0, "network")),
    );
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("radio", { name: "右開き" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^ページめくりの向きを保存できませんでした: Failed to fetch$/,
    );
    expect(screen.getByRole("radio", { name: "左開き" })).toBeChecked();
  });

  it("offers no direction where there is no book", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    expect(screen.queryByRole("radio", { name: "右開き" })).not.toBeInTheDocument();
  });
});

describe("SettingsMenu", () => {
  // The settings outlive the store they are read through: they sit in
  // localStorage so they survive a change of book. A test that turns one off
  // therefore hands it to whichever test runs next, which would make the
  // default-on test below pass or fail on the declaration order alone.
  afterEach(() => {
    localStorage.clear();
  });

  it("shows web search already on, since the assistant falls back to the web by default", async () => {
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    expect(screen.getByRole("checkbox", { name: "Web検索" })).toBeChecked();
  });

  it("turns web search off from the settings menu", async () => {
    const store = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("checkbox", { name: "Web検索" }));

    expect(store.get(useWebSearchAtom)).toBe(false);
  });

  it("stops offering web search when the server's provider cannot do it", async () => {
    // A switch that the server would override is worse than no switch: the
    // reader turns it on, nothing about the answers changes, and there is
    // nothing on screen to say why.
    renderMenu("vim", undefined, false);

    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    expect(screen.queryByRole("checkbox", { name: "Web検索" })).not.toBeInTheDocument();
    // The rest of the menu is untouched: this hides one setting, not the panel
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Vim" })).toBeChecked();
  });

  it("says why the session could not be ended, rather than looking logged out", async () => {
    // The reader would otherwise be shown the shelf again with the cookie still
    // on it, having been told nothing — on a borrowed laptop that is the worst
    // possible time to assume it worked.
    renderMenu("vim", () =>
      errAsync(new ApiError("Failed to fetch", "NETWORK_ERROR", 0, "network")),
    );
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^ログアウトできませんでした: Failed to fetch$/,
    );
    // Still open, so the reader can try again without hunting for the menu
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("says what the arrow keys do, with no bindings chosen and they answer anyway", async () => {
    renderMenu("none");
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    expect(describedKey("←/→")).toBe("前 / 次のページ");
    expect(describedKey("↑/↓")).toBe("スクロール");
  });

  // Whole list rather than a key at a time: the arrows lead because they hold
  // in every mode, and a mode's own keys must not be offered to a reader who
  // has turned that mode off — pressing them would do nothing.
  it.each([
    ["none", ["←/→", "↑/↓"]],
    ["vim", ["←/→", "↑/↓", "l", "h", "j", "k", "t", "/", "gg", "G"]],
    ["emacs", ["←/→", "↑/↓", "C-f", "C-b", "C-n", "C-p", "C-c t", "M-<", "M->"]],
  ] as [KeybindingMode, string[]][])(
    "lists %s mode's keys under the arrows",
    async (mode, keys) => {
      renderMenu(mode);
      await userEvent.click(screen.getByRole("button", { name: "設定" }));

      expect(screen.getAllByRole("term").map((term) => term.textContent)).toStrictEqual(keys);
    },
  );
});

/** What the menu says a key does, read from the `dd` beside its `kbd`. */
function describedKey(keys: string): string | null {
  const term = screen.getByText(keys).closest("dt");
  return term?.nextElementSibling?.textContent ?? null;
}
