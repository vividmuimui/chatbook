/**
 * The books being read by OCR in the background, one at a time.
 *
 * Held in a module rather than in a page: a book of pictures is stored first
 * and read afterwards, which takes minutes, and the reader goes on to the
 * reader, back to the shelf and into other books meanwhile. Nothing in React
 * outlives that — this does, for as long as the tab is open. A tab closed or
 * reloaded stops it; the server still says the book is waiting
 * (`ocrPending`), and the shelf offers to start again.
 *
 * One book at a time: each run holds a PDF document, a Tesseract worker and
 * its language models, and a phone does not have room for two of those.
 */

/** Where a book stands in the queue, as the shelf and the reader show it. */
export type OcrJob =
  /** Behind another book. */
  | { phase: "waiting" }
  /** Being read; `total` is 0 until the pages to read are known. */
  | { phase: "reading"; done: number; total: number }
  /** Read, and being sent to the server. */
  | { phase: "saving" }
  /** Stopped by something other than the reader; it can be started again. */
  | { phase: "failed"; reason: string }
  /** Read to the end, and not a word was found. Stored as done all the same. */
  | { phase: "unreadable" };

/** What a run is handed: the way it is stopped, and the way it says how far it has got. */
export interface OcrRunContext {
  signal: AbortSignal;
  progress: (done: number, total: number) => void;
  saving: () => void;
}

/** One book's reading, start to stored. Resolves with whether any text was found. */
export type OcrRun = (context: OcrRunContext) => Promise<"read" | "unreadable">;

export interface OcrQueue {
  /**
   * Puts a book in the queue. A book already waiting or being read stays as
   * it is — the shelf and the reader may both ask for the same one.
   */
  enqueue: (pdfId: string, run: OcrRun) => void;
  /**
   * Stops a book, whether it is being read or still waiting. It is then out
   * of the queue altogether: the server still has it waiting, which is what
   * the shelf shows from then on.
   */
  cancel: (pdfId: string) => void;
  subscribe: (listener: () => void) => () => void;
  /** The jobs as they stand, a new map whenever one changes (for `useSyncExternalStore`). */
  getSnapshot: () => ReadonlyMap<string, OcrJob>;
}

export function createOcrQueue(): OcrQueue {
  let jobs: ReadonlyMap<string, OcrJob> = new Map();
  const listeners = new Set<() => void>();
  // Which enqueue a job belongs to. A run that settles after its book was
  // cancelled — and perhaps queued again — must not write over what is there now.
  const tokens = new Map<string, object>();
  const waiting: { pdfId: string; run: OcrRun; token: object }[] = [];
  let running: { pdfId: string; controller: AbortController } | null = null;

  const set = (pdfId: string, job: OcrJob | null) => {
    const next = new Map(jobs);
    if (job === null) next.delete(pdfId);
    else next.set(pdfId, job);
    jobs = next;
    for (const listener of listeners) listener();
  };

  const pump = () => {
    if (running) return;
    const next = waiting.shift();
    if (!next) return;
    const { pdfId, run, token } = next;
    const controller = new AbortController();
    running = { pdfId, controller };
    const current = () => tokens.get(pdfId) === token;
    set(pdfId, { phase: "reading", done: 0, total: 0 });

    run({
      signal: controller.signal,
      progress: (done, total) => {
        if (current()) set(pdfId, { phase: "reading", done, total });
      },
      saving: () => {
        if (current()) set(pdfId, { phase: "saving" });
      },
    })
      .then(
        (outcome) => {
          if (!current()) return;
          tokens.delete(pdfId);
          // A book that was read is done, and the server says so: nothing is
          // left to show for it. One where nothing was found says so once.
          set(pdfId, outcome === "unreadable" ? { phase: "unreadable" } : null);
        },
        (cause: unknown) => {
          if (!current()) return;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (error.name === "AbortError") {
            tokens.delete(pdfId);
            set(pdfId, null);
          } else {
            set(pdfId, { phase: "failed", reason: error.message });
          }
        },
      )
      .finally(() => {
        running = null;
        pump();
      });
  };

  return {
    enqueue(pdfId, run) {
      const job = jobs.get(pdfId);
      if (job && (job.phase === "waiting" || job.phase === "reading" || job.phase === "saving")) {
        return;
      }
      const token = {};
      tokens.set(pdfId, token);
      waiting.push({ pdfId, run, token });
      set(pdfId, { phase: "waiting" });
      pump();
    },
    cancel(pdfId) {
      tokens.delete(pdfId);
      const queued = waiting.findIndex((w) => w.pdfId === pdfId);
      if (queued >= 0) waiting.splice(queued, 1);
      if (running?.pdfId === pdfId) running.controller.abort();
      set(pdfId, null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => jobs,
  };
}

/** The tab's one queue. */
export const ocrQueue = createOcrQueue();
