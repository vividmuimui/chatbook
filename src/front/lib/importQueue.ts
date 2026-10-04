/**
 * Dropbox files being brought in all at once, one at a time.
 *
 * Held in a module rather than in a page, like the OCR queue (`ocrQueue.ts`):
 * twenty books take a while, and the reader goes on into a book and back to the
 * shelf meanwhile. Nothing in React outlives that — this does, for as long as
 * the tab is open. A tab closed or reloaded stops it, and what was not brought
 * in yet is simply still waiting in the folder.
 *
 * One file at a time: each holds a whole book's bytes from the download until
 * the server has it, and a phone does not have room for twenty of those. A run
 * lets go of its bytes when it settles, before the next one starts.
 */

/** Where a file stands, as its card on the shelf says. */
export type ImportJob =
  /** Behind another file. */
  | { phase: "waiting" }
  | { phase: "downloading"; ratio: number }
  /** Being read by pdf.js (or the EPUB reader) for its text. */
  | { phase: "reading" }
  /** Being stored; the server fetches the bytes from Dropbox itself. */
  | { phase: "storing" }
  /** Not brought in; the reason is the one the failing step gave. */
  | { phase: "failed"; reason: string };

/** What a run reports while it goes. */
export type ImportProgress = Exclude<ImportJob, { phase: "waiting" } | { phase: "failed" }>;

/** What a run is handed: the way it is stopped, and the way it says how far it has got. */
export interface ImportRunContext {
  signal: AbortSignal;
  report: (progress: ImportProgress) => void;
}

/** One file's import, start to stored. Resolves with the id of the book it became. */
export type ImportRun = (context: ImportRunContext) => Promise<string>;

/**
 * The files handed over since the queue was last idle — what the shelf's
 * "取り込み中 3/20" counts. Kept once everything has run when something failed,
 * so the shelf can say how many and offer to try them again; gone otherwise.
 */
export interface ImportBatch {
  total: number;
  succeeded: number;
  failed: number;
  /** Whether a file is still waiting or being brought in. */
  running: boolean;
}

export interface ImportSnapshot {
  /** Every file waiting, being brought in, or that failed, by Dropbox id. */
  jobs: ReadonlyMap<string, ImportJob>;
  batch: ImportBatch | null;
}

export interface ImportQueue {
  /**
   * Puts a file in the queue. One already waiting or being brought in stays as
   * it is; one that failed is tried again.
   */
  enqueue: (key: string, run: ImportRun) => void;
  /**
   * Stops: every file still waiting leaves the queue, and the one being brought
   * in is told to stop (`signal`). What failed stays failed, to be tried again.
   */
  cancel: () => void;
  /**
   * Takes a waiting file out of the queue, for the reader who opened it from
   * its card to bring in now. False when it was not waiting.
   */
  take: (key: string) => boolean;
  /** Forgets a failure, for a file brought in by other means since. */
  forget: (key: string) => void;
  /**
   * Waits for the file being brought in now: the id of the book it became, or
   * null when it failed or was stopped. Null at once for a file not running.
   */
  settled: (key: string) => Promise<string | null>;
  subscribe: (listener: () => void) => () => void;
  /** The state as it stands, a new object whenever it changes (for `useSyncExternalStore`). */
  getSnapshot: () => ImportSnapshot;
}

const ACTIVE = new Set<ImportJob["phase"]>(["waiting", "downloading", "reading", "storing"]);

export function createImportQueue(): ImportQueue {
  let snapshot: ImportSnapshot = { jobs: new Map(), batch: null };
  const listeners = new Set<() => void>();
  const waiting: { key: string; run: ImportRun }[] = [];
  let running: {
    key: string;
    controller: AbortController;
    waiters: ((id: string | null) => void)[];
  } | null = null;
  // The batch's counts; `total` grows as files are handed over.
  let counts = { total: 0, succeeded: 0, failed: 0 };

  const publish = (jobs: ReadonlyMap<string, ImportJob>) => {
    const busy = running !== null || waiting.length > 0;
    // A batch that ran through without a failure has nothing left to say.
    if (!busy && counts.failed === 0) counts = { total: 0, succeeded: 0, failed: 0 };
    snapshot = {
      jobs,
      batch: counts.total === 0 ? null : { ...counts, running: busy },
    };
    for (const listener of listeners) listener();
  };

  const withJob = (key: string, job: ImportJob | null) => {
    const next = new Map(snapshot.jobs);
    if (job === null) next.delete(key);
    else next.set(key, job);
    return next;
  };

  const pump = () => {
    if (running) return;
    const next = waiting.shift();
    if (!next) {
      publish(snapshot.jobs);
      return;
    }
    const { key, run } = next;
    const controller = new AbortController();
    const current = { key, controller, waiters: [] as ((id: string | null) => void)[] };
    running = current;
    publish(withJob(key, { phase: "downloading", ratio: 0 }));

    const finish = (job: ImportJob | null, id: string | null) => {
      running = null;
      for (const waiter of current.waiters) waiter(id);
      publish(withJob(key, job));
      pump();
    };

    run({
      signal: controller.signal,
      report: (progress) => {
        if (running === current && !controller.signal.aborted) {
          publish(withJob(key, progress));
        }
      },
    }).then(
      (id) => {
        if (running !== current) return;
        counts.succeeded += 1;
        // Brought in: the file is a book now, and its card goes with it.
        finish(null, id);
      },
      (cause: unknown) => {
        if (running !== current) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (controller.signal.aborted || error.name === "AbortError") {
          // Stopped by the reader, which is not a failure to report
          counts.total -= 1;
          finish(null, null);
        } else {
          counts.failed += 1;
          finish({ phase: "failed", reason: error.message }, null);
        }
      },
    );
  };

  return {
    enqueue(key, run) {
      const job = snapshot.jobs.get(key);
      if (job && ACTIVE.has(job.phase)) return;
      // A failure tried again is still one of the files the batch counts
      if (job?.phase === "failed") counts.failed -= 1;
      else counts.total += 1;
      waiting.push({ key, run });
      publish(withJob(key, { phase: "waiting" }));
      pump();
    },
    cancel() {
      let jobs = snapshot.jobs;
      for (const { key } of waiting.splice(0)) {
        counts.total -= 1;
        const next = new Map(jobs);
        next.delete(key);
        jobs = next;
      }
      // The run settles on its own, as stopped; until then it is still there
      running?.controller.abort();
      publish(jobs);
    },
    take(key) {
      const index = waiting.findIndex((w) => w.key === key);
      if (index < 0) return false;
      waiting.splice(index, 1);
      counts.total -= 1;
      publish(withJob(key, null));
      return true;
    },
    forget(key) {
      if (snapshot.jobs.get(key)?.phase !== "failed") return;
      counts.failed -= 1;
      counts.total -= 1;
      publish(withJob(key, null));
    },
    settled(key) {
      if (running?.key !== key) return Promise.resolve(null);
      const waitingFor = running;
      return new Promise((resolve) => waitingFor.waiters.push(resolve));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

/** The tab's one queue. */
export const importQueue = createImportQueue();
