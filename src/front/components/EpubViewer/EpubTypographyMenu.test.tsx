import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { EpubTypographyMenu } from "./EpubTypographyMenu";
import { epubTypographyAtom, readingModeAtom } from "../../atoms/settingsAtom";
import { DEFAULT_EPUB_TYPOGRAPHY, EPUB_FONT_SIZES_PX } from "../../lib/epubTypography";

function renderMenu(store = createStore()) {
  render(
    <Provider store={store}>
      <div>
        <p>本文</p>
        <EpubTypographyMenu />
      </div>
    </Provider>,
  );
  return store;
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "表示の設定" }));
}

describe("EpubTypographyMenu", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("is shut until the reader asks for it", () => {
    renderMenu();
    expect(screen.queryByRole("button", { name: "文字を大きく" })).toBeNull();
    expect(screen.getByRole("button", { name: "表示の設定" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("offers reading by scrolling in place of turning screens", async () => {
    const store = renderMenu();
    await openMenu();

    expect(screen.getByRole("radio", { name: "ページめくり" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "スクロール" }));

    expect(store.get(readingModeAtom)).toBe("scroll");
  });

  it("steps the type up and down, and keeps the choice for the next session", async () => {
    const store = renderMenu();
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "文字を大きく" }));
    await userEvent.click(screen.getByRole("button", { name: "文字を大きく" }));
    await userEvent.click(screen.getByRole("button", { name: "文字を小さく" }));

    expect(store.get(epubTypographyAtom).fontSizeStep).toBe(
      DEFAULT_EPUB_TYPOGRAPHY.fontSizeStep + 1,
    );
    expect(screen.getByRole("status", { name: "文字の大きさ" })).toHaveTextContent("6 / 10");
    expect(JSON.parse(localStorage.getItem("chatbook:epub-typography")!)).toMatchObject({
      fontSizeStep: DEFAULT_EPUB_TYPOGRAPHY.fontSizeStep + 1,
    });
  });

  it("offers no step past the largest size", async () => {
    const store = createStore();
    store.set(epubTypographyAtom, {
      ...DEFAULT_EPUB_TYPOGRAPHY,
      fontSizeStep: EPUB_FONT_SIZES_PX.length - 1,
    });
    renderMenu(store);
    await openMenu();

    expect(screen.getByRole("button", { name: "文字を大きく" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "文字を小さく" })).toBeEnabled();
  });

  it("changes the leading, the alignment, the face and the margins", async () => {
    const store = renderMenu();
    await openMenu();

    const group = (name: string) => within(screen.getByRole("group", { name }));
    await userEvent.click(group("行間").getByRole("radio", { name: "広い" }));
    await userEvent.click(group("配置").getByRole("radio", { name: "両端揃え" }));
    await userEvent.click(group("フォント").getByRole("radio", { name: "明朝" }));
    await userEvent.click(group("余白").getByRole("radio", { name: "狭い" }));

    expect(store.get(epubTypographyAtom)).toStrictEqual({
      ...DEFAULT_EPUB_TYPOGRAPHY,
      lineHeight: "loose",
      textAlign: "justify",
      fontFamily: "serif",
      margin: "narrow",
    });
    expect(group("配置").getByRole("radio", { name: "両端揃え" })).toBeChecked();
  });

  it("puts everything back to the defaults", async () => {
    const store = createStore();
    store.set(epubTypographyAtom, {
      fontSizeStep: 8,
      lineHeight: "tight",
      textAlign: "justify",
      fontFamily: "serif",
      margin: "wide",
    });
    renderMenu(store);
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "既定に戻す" }));

    expect(store.get(epubTypographyAtom)).toStrictEqual(DEFAULT_EPUB_TYPOGRAPHY);
  });

  it("closes on Escape", async () => {
    renderMenu();
    await openMenu();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "文字を大きく" })).toBeNull();
  });

  it("closes on a click outside it, and stays open for one inside", async () => {
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "文字を大きく" }));
    expect(screen.getByRole("button", { name: "文字を大きく" })).toBeInTheDocument();

    await userEvent.click(screen.getByText("本文"));
    expect(screen.queryByRole("button", { name: "文字を大きく" })).toBeNull();
  });
});
