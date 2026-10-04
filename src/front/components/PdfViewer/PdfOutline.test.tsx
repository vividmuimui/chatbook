import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PdfOutline } from "./PdfOutline";

const OUTLINE = [
  {
    title: "第1章 エッジで動かす",
    pageNumber: 2,
    children: [{ title: "1.1 はじめに", pageNumber: 4, children: [] }],
  },
  { title: "第2章 落ちない目次", pageNumber: 9, children: [] },
];

describe("PdfOutline", () => {
  it("marks the section the reader is inside, which is the last one starting at or before the page", () => {
    // The outline is where the reader's place shows on a wide screen: the row
    // of page controls is kept off screens that can hover, so this is what says
    // how far in they are.
    render(<PdfOutline outline={OUTLINE} error={null} currentPage={5} onJump={() => {}} />);

    expect(screen.getByRole("button", { current: "location" })).toHaveTextContent(
      /^1\.1 はじめに4$/,
    );
  });

  it("marks one section even in a book that names two of them the same", () => {
    // 「はじめに」 under every chapter is how technical books are written, and
    // matching a heading by its words would light up each of them at once.
    const repeated = [
      {
        title: "第1章 エッジで動かす",
        pageNumber: 2,
        children: [{ title: "はじめに", pageNumber: 3, children: [] }],
      },
      {
        title: "第2章 落ちない目次",
        pageNumber: 9,
        children: [{ title: "はじめに", pageNumber: 10, children: [] }],
      },
    ];

    render(<PdfOutline outline={repeated} error={null} currentPage={3} onJump={() => {}} />);

    expect(
      screen.getAllByRole("button", { current: "location" }).map((entry) => entry.textContent),
    ).toStrictEqual(["はじめに3"]);
  });

  it("marks the section rather than its chapter where both start on the same page", () => {
    // A chapter whose first section opens on the chapter's own page is ordinary
    // in a technical book, and the reader is in the section: it is the finer of
    // the two answers to "where am I".
    const openingTogether = [
      {
        title: "第1章 エッジで動かす",
        pageNumber: 2,
        children: [{ title: "1.1 はじめに", pageNumber: 2, children: [] }],
      },
    ];

    render(<PdfOutline outline={openingTogether} error={null} currentPage={2} onJump={() => {}} />);

    expect(
      screen.getAllByRole("button", { current: "location" }).map((entry) => entry.textContent),
    ).toStrictEqual(["1.1 はじめに2"]);
  });

  // An EPUB's page is an item of its spine, which can hold a whole chapter:
  // 7.1 to 7.5 are one page there, told apart by where in it each starts.
  describe("in a book whose page holds several sections", () => {
    const sectioned = [
      {
        title: "第7章 認証",
        pageNumber: 14,
        children: [
          { title: "7.1 SAML", pageNumber: 14, offset: 300, anchor: "s1", children: [] },
          { title: "7.2 OAuth", pageNumber: 14, offset: 2400, anchor: "s2", children: [] },
        ],
      },
    ];

    it("marks the section the place in the page is under", () => {
      render(
        <PdfOutline
          outline={sectioned}
          error={null}
          currentPage={14}
          currentOffset={1000}
          onJump={() => {}}
        />,
      );

      expect(screen.getByRole("button", { current: "location" })).toHaveTextContent(/^7\.1 SAML/);
    });

    it("hands the place in the page a section names to the jump", async () => {
      const onJump = vi.fn();
      render(
        <PdfOutline
          outline={sectioned}
          error={null}
          currentPage={1}
          currentOffset={0}
          onJump={onJump}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: /7\.2 OAuth/ }));
      expect(onJump).toHaveBeenCalledWith(14, "s2");
    });

    it("writes what the book says beside each entry, in place of a page no reader counts by", () => {
      render(
        <PdfOutline
          outline={sectioned}
          error={null}
          currentPage={1}
          onJump={() => {}}
          entryLabel={(entry) => `${entry.offset ?? 0}字`}
        />,
      );

      expect(screen.getByRole("button", { name: /7\.2 OAuth/ })).toHaveTextContent(
        /^7\.2 OAuth2400字$/,
      );
    });
  });

  it("never marks a bookmark whose page could not be worked out", () => {
    // `usePdfOutline` lists an unresolvable destination with no page at all. A
    // guard read the other way round would take that as page zero and light it
    // up as the place being read.
    const unresolved = [
      { title: "第1章 エッジで動かす", pageNumber: null, children: [] },
      { title: "第2章 落ちない目次", pageNumber: 9, children: [] },
    ];

    render(<PdfOutline outline={unresolved} error={null} currentPage={4} onJump={() => {}} />);

    expect(screen.getAllByRole("button").map((entry) => entry.textContent)).toStrictEqual([
      "第1章 エッジで動かす",
      "第2章 落ちない目次9",
    ]);
    expect(screen.queryAllByRole("button", { current: "location" })).toStrictEqual([]);
  });

  it("marks nothing while the reader is still ahead of the first bookmark", () => {
    render(<PdfOutline outline={OUTLINE} error={null} currentPage={1} onJump={() => {}} />);

    expect(screen.getAllByRole("button").map((entry) => entry.textContent)).toStrictEqual([
      "第1章 エッジで動かす2",
      "1.1 はじめに4",
      "第2章 落ちない目次9",
    ]);
    expect(screen.queryAllByRole("button", { current: "location" })).toStrictEqual([]);
  });

  it("says the table of contents could not be read rather than showing the book as having none", () => {
    render(
      <PdfOutline
        outline={null}
        error="Invalid outline destination"
        currentPage={1}
        onJump={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^目次を読み込めませんでした: Invalid outline destination$/,
    );
  });

  it("says a book without a table of contents has none", () => {
    render(<PdfOutline outline={[]} error={null} currentPage={1} onJump={() => {}} />);

    expect(screen.getByText("この本には目次がありません")).toBeInTheDocument();
  });
});

describe("PdfOutline for a book without a table of contents", () => {
  it("offers to have one made", async () => {
    const onGenerate = vi.fn();
    render(
      <PdfOutline
        outline={[]}
        error={null}
        currentPage={1}
        onJump={() => {}}
        generation={{ onGenerate, generating: false, error: null }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "AIで目次を作る" }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("says it is making one, and will not be asked twice meanwhile", () => {
    render(
      <PdfOutline
        outline={[]}
        error={null}
        currentPage={1}
        onJump={() => {}}
        generation={{ onGenerate: () => {}, generating: true, error: null }}
      />,
    );

    expect(screen.getByRole("button", { name: "目次を作成中..." })).toBeDisabled();
  });

  it("says why none could be made, and leaves the offer up to try again", () => {
    render(
      <PdfOutline
        outline={[]}
        error={null}
        currentPage={1}
        onJump={() => {}}
        generation={{
          onGenerate: () => {},
          generating: false,
          error: "The model could not be reached",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^目次を作成できませんでした: The model could not be reached$/,
    );
    expect(screen.getByRole("button", { name: "AIで目次を作る" })).toBeEnabled();
  });

  it("offers nothing to make where the book has a table of contents", () => {
    render(
      <PdfOutline
        outline={OUTLINE}
        error={null}
        currentPage={1}
        onJump={() => {}}
        generation={{ onGenerate: () => {}, generating: false, error: null }}
      />,
    );

    expect(screen.queryByRole("button", { name: "AIで目次を作る" })).not.toBeInTheDocument();
  });
});
