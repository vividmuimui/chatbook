import { describe, it, expect } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { BookSearch } from "./BookSearch";
import { bookSearchOpenAtom } from "../../atoms/bookSearchAtom";
import { citedPassageAtom, currentPageAtom } from "../../atoms/pdfAtom";
import { SwrTestCache } from "../../../test/swrTestCache";
import { PHONE_WIDTH, setViewportWidth } from "../../../test/viewport";
import { ApiError } from "../../lib/fetcher";
import type { SearchBookText } from "../../hooks/useBookTextSearch";
import type { BookSearchResult } from "../../../shared/schemas/bookSearch";

const BOOK_ID = "p1";

const TWO_MATCHES: BookSearchResult = {
  matches: [
    { pageNumber: 3, before: "Workers run at the ", match: "edge", after: " of the network" },
    { pageNumber: 12, before: "cut at the ", match: "Edge", after: "" },
  ],
  truncated: false,
};

/** A search that answers with `answer` and remembers what it was asked. */
function recordingSearch(answer: BookSearchResult | Error = TWO_MATCHES) {
  const asked: string[] = [];
  const search: SearchBookText = (_pdfId, query) => {
    asked.push(query);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { search, asked };
}

function renderSearch(search: SearchBookText) {
  const store = createStore();
  store.set(bookSearchOpenAtom, true);
  render(
    <Provider store={store}>
      <SwrTestCache>
        <BookSearch pdfId={BOOK_ID} search={search} />
      </SwrTestCache>
    </Provider>,
  );
  return store;
}

describe("BookSearch", () => {
  it("stays away until it is asked for", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <BookSearch pdfId={BOOK_ID} search={recordingSearch().search} />
      </Provider>,
    );

    expect(screen.queryByRole("region", { name: "本文の検索" })).not.toBeInTheDocument();
  });

  it("opens ready to type into", () => {
    renderSearch(recordingSearch().search);

    expect(screen.getByLabelText("本文から探す語")).toHaveFocus();
  });

  it("does not search while the reader is still typing", async () => {
    const { search, asked } = recordingSearch();
    renderSearch(search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), "edge");

    expect(asked).toStrictEqual([]);
  });

  it("searches on the button, and lists each place with its page and the words marked", async () => {
    const { search, asked } = recordingSearch();
    renderSearch(search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), " edge ");
    await userEvent.click(screen.getByRole("button", { name: "本文を検索" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^2件$/);
    expect(asked).toStrictEqual(["edge"]);
    const results = screen.getAllByRole("listitem");
    expect(results[0]).toHaveTextContent(/^p\.3…Workers run at the edge of the network…$/);
    expect(results[0].querySelector("mark")).toHaveTextContent(/^edge$/);
    expect(results[1]).toHaveTextContent(/^p\.12…cut at the Edge$/);
  });

  it("searches on Enter, but not on the Enter that confirms a Japanese word", async () => {
    const { search, asked } = recordingSearch();
    renderSearch(search);
    const box = screen.getByLabelText("本文から探す語");

    await userEvent.type(box, "エッジ");
    // What an IME reports for the Enter that confirms its candidate
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
    expect(asked).toStrictEqual([]);

    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(asked).toStrictEqual(["エッジ"]));
  });

  it("says when the words are nowhere in the book", async () => {
    renderSearch(recordingSearch({ matches: [], truncated: false }).search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), "みつからない語{Enter}");

    expect(await screen.findByText("見つかりませんでした")).toBeInTheDocument();
  });

  it("says the list was cut off rather than passing it off as every place", async () => {
    renderSearch(recordingSearch({ ...TWO_MATCHES, truncated: true }).search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), "edge{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(/^2件以上（先頭の2件を表示）$/);
  });

  it("says why when the search could not be run", async () => {
    renderSearch(
      recordingSearch(new ApiError("PDF not found", "PDF_NOT_FOUND", 404, "http")).search,
    );

    await userEvent.type(screen.getByLabelText("本文から探す語"), "edge{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^本文を検索できませんでした: PDF not found$/,
    );
  });

  it("turns to the page a result is on and marks the words between the text around them", async () => {
    const store = renderSearch(recordingSearch().search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), "edge{Enter}");
    await userEvent.click((await screen.findAllByRole("button", { name: /^p\.12/ }))[0]);

    expect(store.get(currentPageAtom)).toBe(12);
    expect(store.get(citedPassageAtom)).toStrictEqual({
      pageNumber: 12,
      text: "Edge",
      context: { before: "cut at the ", after: "" },
    });
    // Beside the page, it stays up for the next result
    expect(store.get(bookSearchOpenAtom)).toBe(true);
  });

  it("gets out of the way of the page it turned to on one column", async () => {
    setViewportWidth(PHONE_WIDTH);
    const store = renderSearch(recordingSearch().search);

    await userEvent.type(screen.getByLabelText("本文から探す語"), "edge{Enter}");
    await userEvent.click((await screen.findAllByRole("button", { name: /^p\.3/ }))[0]);

    expect(store.get(currentPageAtom)).toBe(3);
    expect(store.get(bookSearchOpenAtom)).toBe(false);
  });

  it("closes on one column when the page behind it is tapped", async () => {
    setViewportWidth(PHONE_WIDTH);
    const store = renderSearch(recordingSearch().search);

    await userEvent.click(screen.getByRole("button", { name: "検索を閉じる" }));

    expect(store.get(bookSearchOpenAtom)).toBe(false);
  });
});
