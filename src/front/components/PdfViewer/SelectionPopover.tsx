// oxlint-disable-next-line no-restricted-imports -- document への keydown / mousedown / copy 購読 (Escape と外側クリックで閉じる、コピーに抜粋を渡す) に必要
import { useState, useRef, useEffect } from "react";
import { isSubmitKey } from "../../lib/isSubmitKey";
import { ColorSwatches } from "../ColorSwatches";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  MAX_NOTE_LENGTH,
  type HighlightColor,
} from "../../../shared/schemas/selection";

/** What the box is for: a question to the AI, or a note kept with the highlight. */
export type SelectionBoxMode = "ask" | "note";

/**
 * How far above the selected line a floating box is put, so it sits over the
 * lines before the passage rather than on it: its own height — the swatch row,
 * the field and the buttons — and the tail beneath them.
 */
export const POPOVER_LIFT_PX = 180;

interface SelectionPopoverProps {
  /** The passage the box is about, and what a copy made while it is up yields. */
  quote: string;
  /**
   * Asks the question. Awaited, so the popover can hold the reader off until
   * the ask has been dealt with: it stays open when the highlight could not be
   * stored, and a popover that stays open is one that can be submitted twice.
   */
  onSubmit: (question: string) => void | Promise<void>;
  /**
   * Keeps the passage as a highlight in a colour, with a note when one was
   * written, and asks nothing. Awaited for the same reason `onSubmit` is: the
   * box stays up on a highlight that was not stored.
   */
  onMark: (color: HighlightColor, note: string | null) => void | Promise<void>;
  onDismiss: () => void;
  /** Which of the two the box opens on: a note, when the bar's "メモ" opened it. */
  initialMode?: SelectionBoxMode;
  /**
   * Whether it is floating over the passage, which is where its card and the
   * tail beneath it come from. Held along the bottom of the pane instead — the
   * one column layout — it is already on a surface of its own, and a tail would
   * point at the toolbar rather than at anything it is about.
   */
  floating?: boolean;
}

/**
 * What the reader can do with the passage they selected, shown above it: mark
 * it in a colour, keep a note with it, or ask about it. The caller positions
 * it; this component owns the input, submit and dismiss behaviour, and the
 * clipboard for as long as it is up.
 */
export function SelectionPopover({
  quote,
  onSubmit,
  onMark,
  onDismiss,
  initialMode = "ask",
  floating = true,
}: SelectionPopoverProps) {
  const [mode, setMode] = useState<SelectionBoxMode>(initialMode);
  /**
   * What is in the field. One text for both modes, so a reader who started
   * typing a question and decided it was a note to self keeps what they wrote.
   */
  const [question, setQuestion] = useState("");
  /** The colour a note is kept in. Swatches only act at once in the ask mode. */
  const [noteColor, setNoteColor] = useState<HighlightColor>(DEFAULT_HIGHLIGHT_COLOR);
  /**
   * Which store is in flight. One gate for both: a highlight marked while a
   * question about the same passage is still being stored would be a second
   * highlight of it, and so would a second mark.
   */
  const [busy, setBusy] = useState<"ask" | "mark" | null>(null);
  const asking = busy !== null;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Focus the field on mount, and again when the box turns from one use to the
  // other: the button that turned it took the focus away.
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  /**
   * Hand the passage to a copy made while this box is up.
   *
   * Focusing the field collapses the browser's own selection, so the passage
   * only looks selected from here on (the overlay keeps drawing it) and a plain
   * Cmd+C would put nothing on the clipboard. Guarded twice: what the reader
   * typed and any selection still standing elsewhere are theirs to copy.
   */
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target;
      if (
        (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
        target.selectionStart !== target.selectionEnd
      ) {
        return;
      }

      const live = window.getSelection();
      if (live && !live.isCollapsed && live.toString() !== "") return;

      if (!e.clipboardData) return;
      e.clipboardData.setData("text/plain", quote);
      e.preventDefault();
    };
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [quote]);

  // Dismiss on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  // Dismiss on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Only the primary button dismisses. A right click outside is how a
      // passage is copied without the keyboard, and closing on it takes the
      // selection away before the menu the reader asked for is even up.
      if (e.button !== 0) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Delay to avoid dismissing on the same mouseup that triggered this
    setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onDismiss]);

  /** Runs one store at a time, and puts a failed one back within reach. */
  const runStore = async (kind: "ask" | "mark", store: () => void | Promise<void>) => {
    setBusy(kind);
    try {
      await store();
    } catch {
      // Reporting is the asker's job — it owns the message and where it shows.
      // Swallowing here only stops a rejection escaping an event handler,
      // where nothing (not even the route's errorElement) would catch it.
    } finally {
      // A successful store unmounts this popover, so this only ever puts a
      // failed one back within reach of the reader.
      setBusy(null);
    }
  };

  const noting = mode === "note";

  const handleSubmit = async () => {
    const q = question.trim();
    // One store at a time. Both routes in (the button and Enter) come through
    // here, and the swatches through `handleMark`, so these are the only gates.
    if (!q || asking) return;

    if (noting) {
      await runStore("mark", () => onMark(noteColor, q));
      return;
    }
    await runStore("ask", () => onSubmit(q));
  };

  const handleMark = (color: HighlightColor) => {
    if (asking) return;
    void runStore("mark", () => onMark(color, null));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitKey(e.nativeEvent as unknown as KeyboardEvent)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const submitLabel = noting
    ? busy === "mark"
      ? "保存中..."
      : "メモ付きでマーク"
    : busy === "ask"
      ? "送信中..."
      : "質問する";

  return (
    <div
      ref={popoverRef}
      className={
        floating ? "relative bg-white rounded-lg shadow-xl border border-gray-200 p-3" : "relative"
      }
    >
      {floating && (
        <div
          className="absolute left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45"
          style={{ top: "calc(100% - 6px)" }}
        />
      )}
      {/* Marking comes first, the way a reader marks a book before writing in
          its margin. In the ask mode a swatch keeps the passage at once; once
          the box is for a note, the swatches pick the colour it is kept in. */}
      <div className="-mx-1 mb-1 flex items-center justify-between gap-1">
        <ColorSwatches
          labelOf={(name) => (noting ? `${name}を選ぶ` : `${name}でマーク`)}
          selected={noting ? noteColor : undefined}
          onPick={noting ? setNoteColor : handleMark}
          disabled={asking}
        />
        <button
          type="button"
          onClick={() => setMode(noting ? "ask" : "note")}
          disabled={asking}
          className="h-11 shrink-0 cursor-pointer rounded-md px-2 text-xs text-blue-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {noting ? "質問を書く" : "メモを書く"}
        </button>
      </div>
      <textarea
        ref={inputRef}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={noting ? "選択した文章にメモを書く..." : "選択した文章について質問する..."}
        readOnly={asking}
        maxLength={noting ? MAX_NOTE_LENGTH : undefined}
        className="w-full min-w-[280px] p-2 text-sm border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent read-only:bg-gray-50"
        rows={2}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onDismiss}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!question.trim() || asking}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
