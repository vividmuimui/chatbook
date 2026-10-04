import { describe, it, expect } from "vite-plus/test";
import { createOcrQueue, type OcrRun, type OcrRunContext } from "./ocrQueue";

/** A run the test steps through: it starts, reports, and ends when told to. */
function steppedRun() {
  let context: OcrRunContext | null = null;
  let finish: (outcome: "read" | "unreadable") => void = () => {};
  let fail: (cause: unknown) => void = () => {};
  const run: OcrRun = (ctx) => {
    context = ctx;
    ctx.signal.addEventListener("abort", () =>
      fail(Object.assign(new Error("OCR was cancelled"), { name: "AbortError" })),
    );
    return new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  };
  return {
    run,
    started: () => context !== null,
    context: () => context!,
    finish: (outcome: "read" | "unreadable" = "read") => finish(outcome),
    fail: (cause: unknown) => fail(cause),
  };
}

/** Lets the queue's promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ocrQueue", () => {
  it("reads one book at a time, the next once the first is done", async () => {
    const queue = createOcrQueue();
    const first = steppedRun();
    const second = steppedRun();

    queue.enqueue("a", first.run);
    queue.enqueue("b", second.run);

    expect(first.started()).toBe(true);
    expect(second.started()).toBe(false);
    expect(queue.getSnapshot().get("b")).toStrictEqual({ phase: "waiting" });

    first.finish();
    await settle();

    expect(queue.getSnapshot().has("a")).toBe(false);
    expect(second.started()).toBe(true);
  });

  it("says how far a book has got, and when it is being saved", () => {
    const queue = createOcrQueue();
    const book = steppedRun();
    queue.enqueue("a", book.run);

    expect(queue.getSnapshot().get("a")).toStrictEqual({ phase: "reading", done: 0, total: 0 });
    book.context().progress(12, 200);
    expect(queue.getSnapshot().get("a")).toStrictEqual({ phase: "reading", done: 12, total: 200 });
    book.context().saving();
    expect(queue.getSnapshot().get("a")).toStrictEqual({ phase: "saving" });
  });

  it("asks for a book once, however many times it is queued while it runs", () => {
    const queue = createOcrQueue();
    const first = steppedRun();
    const again = steppedRun();

    queue.enqueue("a", first.run);
    queue.enqueue("a", again.run);

    expect(again.started()).toBe(false);
  });

  it("stops the book being read on cancel, and forgets it", async () => {
    const queue = createOcrQueue();
    const book = steppedRun();
    const next = steppedRun();
    queue.enqueue("a", book.run);
    queue.enqueue("b", next.run);

    queue.cancel("a");

    expect(book.context().signal.aborted).toBe(true);
    expect(queue.getSnapshot().has("a")).toBe(false);
    await settle();
    // Not a failure: the reader asked for it.
    expect(queue.getSnapshot().has("a")).toBe(false);
    expect(next.started()).toBe(true);
  });

  it("takes a waiting book out of the queue on cancel, without ever starting it", async () => {
    const queue = createOcrQueue();
    const first = steppedRun();
    const waiting = steppedRun();
    queue.enqueue("a", first.run);
    queue.enqueue("b", waiting.run);

    queue.cancel("b");
    first.finish();
    await settle();

    expect(waiting.started()).toBe(false);
    expect(queue.getSnapshot().size).toBe(0);
  });

  it("keeps the reason a run failed, and lets the book be started again", async () => {
    const queue = createOcrQueue();
    const broken = steppedRun();
    queue.enqueue("a", broken.run);

    broken.fail(new Error("Failed to fetch"));
    await settle();
    expect(queue.getSnapshot().get("a")).toStrictEqual({
      phase: "failed",
      reason: "Failed to fetch",
    });

    const retry = steppedRun();
    queue.enqueue("a", retry.run);
    expect(retry.started()).toBe(true);
  });

  it("says once that nothing could be read off a book", async () => {
    const queue = createOcrQueue();
    const blank = steppedRun();
    queue.enqueue("a", blank.run);

    blank.finish("unreadable");
    await settle();

    expect(queue.getSnapshot().get("a")).toStrictEqual({ phase: "unreadable" });
  });

  it("does not let a cancelled run that ends late write over the book queued again", async () => {
    const queue = createOcrQueue();
    let lateFinish: () => void = () => {};
    // A run that ignores its signal and ends only when it pleases
    queue.enqueue("a", () => new Promise((resolve) => (lateFinish = () => resolve("read"))));
    queue.cancel("a");
    const again = steppedRun();
    queue.enqueue("a", again.run);

    lateFinish();
    await settle();

    expect(queue.getSnapshot().get("a")?.phase).not.toBeUndefined();
    expect(again.started()).toBe(true);
  });

  it("tells its listeners whenever a job changes", () => {
    const queue = createOcrQueue();
    let heard = 0;
    const unsubscribe = queue.subscribe(() => heard++);

    queue.enqueue("a", steppedRun().run);
    unsubscribe();
    queue.cancel("a");

    // waiting, then reading
    expect(heard).toBe(2);
  });
});
