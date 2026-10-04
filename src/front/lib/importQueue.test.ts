import { describe, it, expect } from "vite-plus/test";
import { createImportQueue, type ImportRun, type ImportRunContext } from "./importQueue";

/** A run the test steps through: it starts, reports, and ends when told to. */
function steppedRun() {
  let context: ImportRunContext | null = null;
  let finish: (id: string) => void = () => {};
  let fail: (cause: unknown) => void = () => {};
  let calls = 0;
  const run: ImportRun = (ctx) => {
    calls += 1;
    context = ctx;
    ctx.signal.addEventListener("abort", () =>
      fail(Object.assign(new Error("stopped"), { name: "AbortError" })),
    );
    return new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  };
  return {
    run,
    started: () => context !== null,
    calls: () => calls,
    context: () => context!,
    finish: (id = "book") => finish(id),
    fail: (cause: unknown) => fail(cause),
  };
}

/** Lets the queue's promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("importQueue", () => {
  it("brings one file in at a time, the next once the first is stored", async () => {
    const queue = createImportQueue();
    const first = steppedRun();
    const second = steppedRun();

    queue.enqueue("id:a", first.run);
    queue.enqueue("id:b", second.run);

    expect(first.started()).toBe(true);
    expect(second.started()).toBe(false);
    expect(queue.getSnapshot().jobs.get("id:b")).toStrictEqual({ phase: "waiting" });
    expect(queue.getSnapshot().batch).toStrictEqual({
      total: 2,
      succeeded: 0,
      failed: 0,
      running: true,
    });

    first.finish("book-a");
    await settle();

    expect(queue.getSnapshot().jobs.has("id:a")).toBe(false);
    expect(second.started()).toBe(true);
    expect(queue.getSnapshot().batch).toMatchObject({ total: 2, succeeded: 1 });
  });

  it("says how far a file has got", () => {
    const queue = createImportQueue();
    const file = steppedRun();
    queue.enqueue("id:a", file.run);

    expect(queue.getSnapshot().jobs.get("id:a")).toStrictEqual({
      phase: "downloading",
      ratio: 0,
    });
    file.context().report({ phase: "downloading", ratio: 0.45 });
    expect(queue.getSnapshot().jobs.get("id:a")).toStrictEqual({
      phase: "downloading",
      ratio: 0.45,
    });
    file.context().report({ phase: "reading" });
    expect(queue.getSnapshot().jobs.get("id:a")).toStrictEqual({ phase: "reading" });
  });

  it("leaves nothing to say once every file is in", async () => {
    const queue = createImportQueue();
    const file = steppedRun();
    queue.enqueue("id:a", file.run);

    file.finish();
    await settle();

    expect(queue.getSnapshot()).toStrictEqual({ jobs: new Map(), batch: null });
  });

  it("goes on past a file that failed, and keeps the failure to be tried again", async () => {
    const queue = createImportQueue();
    const first = steppedRun();
    const second = steppedRun();
    queue.enqueue("id:a", first.run);
    queue.enqueue("id:b", second.run);

    first.fail(new Error("Dropbox is down"));
    await settle();
    expect(second.started()).toBe(true);
    second.finish();
    await settle();

    expect(queue.getSnapshot().jobs.get("id:a")).toStrictEqual({
      phase: "failed",
      reason: "Dropbox is down",
    });
    expect(queue.getSnapshot().batch).toStrictEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      running: false,
    });

    // Tried again: a new run for the same file
    const retry = steppedRun();
    queue.enqueue("id:a", retry.run);
    expect(retry.started()).toBe(true);
    // Still one of the two files the batch is about
    expect(queue.getSnapshot().batch).toStrictEqual({
      total: 2,
      succeeded: 1,
      failed: 0,
      running: true,
    });
    retry.finish();
    await settle();
    expect(queue.getSnapshot()).toStrictEqual({ jobs: new Map(), batch: null });
  });

  it("does not take the same file twice while it is waiting or being brought in", () => {
    const queue = createImportQueue();
    const first = steppedRun();
    const again = steppedRun();
    queue.enqueue("id:a", first.run);
    queue.enqueue("id:a", again.run);

    expect(again.calls()).toBe(0);
    expect(queue.getSnapshot().batch).toMatchObject({ total: 1 });
  });

  it("stops: what waits leaves the queue, the file being brought in is told to stop, and no failure is counted", async () => {
    const queue = createImportQueue();
    const first = steppedRun();
    const second = steppedRun();
    queue.enqueue("id:a", first.run);
    queue.enqueue("id:b", second.run);

    queue.cancel();
    expect(first.context().signal.aborted).toBe(true);
    await settle();

    expect(second.started()).toBe(false);
    expect(queue.getSnapshot()).toStrictEqual({ jobs: new Map(), batch: null });
  });

  it("hands a waiting file over to the reader who opened it, and says when it was not waiting", () => {
    const queue = createImportQueue();
    const first = steppedRun();
    const second = steppedRun();
    queue.enqueue("id:a", first.run);
    queue.enqueue("id:b", second.run);

    expect(queue.take("id:b")).toBe(true);
    expect(queue.getSnapshot().jobs.has("id:b")).toBe(false);
    expect(queue.getSnapshot().batch).toMatchObject({ total: 1 });
    // The one being brought in is not the reader's to take
    expect(queue.take("id:a")).toBe(false);
  });

  it("tells whoever waits on the file being brought in which book it became", async () => {
    const queue = createImportQueue();
    const file = steppedRun();
    queue.enqueue("id:a", file.run);

    const book = queue.settled("id:a");
    file.finish("book-a");

    expect(await book).toBe("book-a");
    expect(await queue.settled("id:other")).toBeNull();
  });

  it("tells them null when the file failed", async () => {
    const queue = createImportQueue();
    const file = steppedRun();
    queue.enqueue("id:a", file.run);

    const book = queue.settled("id:a");
    file.fail(new Error("no"));

    expect(await book).toBeNull();
  });

  it("forgets a failure for a file brought in by other means", async () => {
    const queue = createImportQueue();
    const file = steppedRun();
    queue.enqueue("id:a", file.run);
    file.fail(new Error("no"));
    await settle();

    queue.forget("id:a");

    expect(queue.getSnapshot()).toStrictEqual({ jobs: new Map(), batch: null });
  });

  it("tells its listeners whenever something changes", () => {
    const queue = createImportQueue();
    let heard = 0;
    queue.subscribe(() => (heard += 1));

    queue.enqueue("id:a", steppedRun().run);

    expect(heard).toBeGreaterThan(0);
  });
});
