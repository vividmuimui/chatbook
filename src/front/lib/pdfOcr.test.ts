import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  MAX_OCR_RENDER_SIDE,
  OCR_RENDER_SCALE,
  ocrRenderScale,
  readPagesByOcr,
  type OcrEngine,
} from "./pdfOcr";

/** A document whose pages are A4 and draw instantly, recording what was drawn. */
function fakeDocument() {
  const drawn: { pageNumber: number; width: number; height: number }[] = [];
  const cleaned: number[] = [];
  const doc = {
    getPage: async (pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
      render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
        drawn.push({ pageNumber, width: canvas.width, height: canvas.height });
        return { promise: Promise.resolve() };
      },
      cleanup: () => cleaned.push(pageNumber),
    }),
  } as unknown as PDFDocumentProxy;
  return { doc, drawn, cleaned };
}

/** An engine that reads one line per page, saying which canvas it was handed. */
function fakeEngine(recognize?: OcrEngine["recognize"]) {
  const seen: HTMLCanvasElement[] = [];
  const engine: OcrEngine & { terminated: boolean } = {
    terminated: false,
    recognize:
      recognize ??
      (async (canvas) => {
        seen.push(canvas);
        return [{ text: `line ${seen.length}`, bbox: { x0: 20, y0: 40, x1: 220, y1: 80 } }];
      }),
    terminate: async () => {
      engine.terminated = true;
    },
  };
  return { engine, seen };
}

describe("ocrRenderScale", () => {
  it("draws an ordinary page at the scale OCR reads best at", () => {
    expect(ocrRenderScale(595, 842)).toBe(OCR_RENDER_SCALE);
  });

  it("draws a very large page smaller, so one page cannot take the memory", () => {
    const scale = ocrRenderScale(2000, 3000);
    expect(3000 * scale).toBeCloseTo(MAX_OCR_RENDER_SIDE);
  });
});

describe("readPagesByOcr", () => {
  it("reads the named pages in turn and brings the lines back to page units", async () => {
    const { doc, drawn } = fakeDocument();
    const { engine } = fakeEngine();

    const pages = await readPagesByOcr(doc, [2, 4], async () => engine);

    expect(drawn.map((d) => d.pageNumber)).toStrictEqual([2, 4]);
    expect(drawn[0]).toMatchObject({
      width: 595 * OCR_RENDER_SCALE,
      height: 842 * OCR_RENDER_SCALE,
    });
    expect(pages).toStrictEqual([
      { pageNumber: 2, lines: [{ text: "line 1", x: 10, y: 20, width: 100, height: 20 }] },
      { pageNumber: 4, lines: [{ text: "line 2", x: 10, y: 20, width: 100, height: 20 }] },
    ]);
  });

  it("says how far it has got, starting before the first page is read", async () => {
    const { doc } = fakeDocument();
    const { engine } = fakeEngine();
    const progress = vi.fn();

    await readPagesByOcr(doc, [1, 2, 3], async () => engine, { onProgress: progress });

    expect(progress.mock.calls.map(([p]) => p)).toStrictEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("lets go of each page's canvas and the engine once it is done", async () => {
    const { doc, cleaned } = fakeDocument();
    const { engine, seen } = fakeEngine();

    await readPagesByOcr(doc, [1, 2], async () => engine);

    expect(seen.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(cleaned).toStrictEqual([1, 2]);
    expect(engine.terminated).toBe(true);
  });

  it("stops between pages when the reader cancels, and lets go of the engine", async () => {
    const { doc, drawn } = fakeDocument();
    const controller = new AbortController();
    const { engine } = fakeEngine(async () => {
      controller.abort();
      return [];
    });

    await expect(
      readPagesByOcr(doc, [1, 2, 3], async () => engine, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(drawn.map((d) => d.pageNumber)).toStrictEqual([1]);
    expect(engine.terminated).toBe(true);
  });

  it("does not wait out a page being read when the reader cancels", async () => {
    const { doc } = fakeDocument();
    const controller = new AbortController();
    // A recognition that never answers, as a long page would seem to
    const { engine } = fakeEngine(() => new Promise(() => {}));

    const reading = readPagesByOcr(doc, [1], async () => engine, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.terminated).toBe(true);
  });

  it("does not start the engine when cancelled before it began", async () => {
    const { doc } = fakeDocument();
    const controller = new AbortController();
    controller.abort();
    const create = vi.fn();

    await expect(
      readPagesByOcr(doc, [1], create, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });
});
