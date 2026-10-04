import { describe, it, expect } from "vite-plus/test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { EpubPageStepper } from "./EpubPageStepper";
import { currentPageAtom } from "../../atoms/pdfAtom";
import { epubProgressAtom, epubScreenAtom } from "../../atoms/epubAtom";

const CHAPTERS = 3;

function renderStepper(page: number, screenIndex: number, count: number) {
  const store = createStore();
  store.set(currentPageAtom, page);
  store.set(epubScreenAtom, { page, screen: screenIndex, count });
  render(
    <Provider store={store}>
      <EpubPageStepper pageCount={CHAPTERS} />
    </Provider>,
  );
  return store;
}

describe("EpubPageStepper", () => {
  it("names the heading the reader is under, how far into the book, and the screen of the chapter", () => {
    const store = renderStepper(2, 2, 12);
    act(() => store.set(epubProgressAtom, { percent: 42, section: "7.3 認証の回避" }));

    expect(screen.getByText("7.3 認証の回避", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("42%", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("3 / 12", { exact: true })).toBeInTheDocument();
    // Never the item of the spine the chapter is: that is how the file is cut
    expect(screen.queryByText(/\/ 3 章/)).toBeNull();
  });

  it("says how far and which screen alone for a book without contents", () => {
    const store = renderStepper(2, 0, 4);
    act(() => store.set(epubProgressAtom, { percent: 30, section: null }));

    expect(screen.getByText("30%", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("1 / 4", { exact: true })).toBeInTheDocument();
  });

  it("turns a screen on, and on into the next chapter from the last screen", async () => {
    const store = renderStepper(2, 10, 12);

    await userEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(screen.getByText("12 / 12", { exact: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(store.get(currentPageAtom)).toBe(3);
    expect(store.get(epubScreenAtom)).toMatchObject({ page: 3, screen: 0 });
  });

  it("turns back into the end of the chapter before from the first screen", async () => {
    const store = renderStepper(2, 0, 12);

    await userEvent.click(screen.getByRole("button", { name: "前のページ" }));

    expect(store.get(currentPageAtom)).toBe(1);
    expect(store.get(epubScreenAtom)).toMatchObject({ page: 1, screen: "last" });
  });

  it("has nothing to turn to at either end of the book", () => {
    renderStepper(1, 0, 4);
    expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次のページ" })).toBeEnabled();
  });

  it("has nothing on past the last screen of the last chapter", () => {
    renderStepper(CHAPTERS, 3, 4);
    expect(screen.getByRole("button", { name: "次のページ" })).toBeDisabled();
  });
});
