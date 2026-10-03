import type { PageDirection } from "../../shared/schemas/book";
import { turnToward, type ScreenSide } from "./touchNavigation";

export type KeybindingMode = "none" | "vim" | "emacs";

export type ViewerAction =
  | "nextPage"
  | "prevPage"
  | "firstPage"
  | "lastPage"
  | "scrollDown"
  | "scrollUp"
  | "toggleOutline"
  /** Puts the search through the book's text up, with its box ready to type in. */
  | "openSearch";

/** The parts of a KeyboardEvent the resolver needs, so it stays DOM-free. */
export interface KeyStroke {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface ResolveResult {
  action: ViewerAction | null;
  /** Prefix carried into the next stroke, e.g. "g" or "C-c". */
  pending: string | null;
}

const NOTHING: ResolveResult = { action: null, pending: null };

function isPlain(stroke: KeyStroke): boolean {
  return !stroke.ctrlKey && !stroke.altKey && !stroke.metaKey;
}

function isCtrl(stroke: KeyStroke, key: string): boolean {
  return stroke.ctrlKey && !stroke.altKey && !stroke.metaKey && stroke.key.toLowerCase() === key;
}

function isAlt(stroke: KeyStroke, key: string): boolean {
  return stroke.altKey && !stroke.ctrlKey && !stroke.metaKey && stroke.key === key;
}

/** The page turn toward a side of the screen, as the action that makes it. */
function pageToward(side: ScreenSide, direction: PageDirection): ViewerAction {
  return turnToward(side, direction) === "next" ? "nextPage" : "prevPage";
}

/**
 * The arrow keys, which belong to every mode — including "none".
 *
 * They are what a reader who has chosen no bindings still reaches for, so they
 * are resolved before the mode is consulted. `shiftKey` counts as a modifier
 * here: shift with an arrow extends a text selection, and taking that would
 * cost the reader the very thing the popover asks them to pick.
 *
 * ← and → point at a side of the screen, so which page they turn to follows
 * the way the book opens: in one that opens on the right, ← is the next page.
 */
function resolveArrows(stroke: KeyStroke, direction: PageDirection): ViewerAction | null {
  if (!isPlain(stroke) || stroke.shiftKey) return null;

  switch (stroke.key) {
    case "ArrowRight":
      return pageToward("right", direction);
    case "ArrowLeft":
      return pageToward("left", direction);
    case "ArrowDown":
      return "scrollDown";
    case "ArrowUp":
      return "scrollUp";
    default:
      return null;
  }
}

/**
 * vim's own keys. h and l are vim's left and right, so they turn toward those
 * sides of the screen just as the arrows do.
 */
function resolveVim(
  stroke: KeyStroke,
  pending: string | null,
  direction: PageDirection,
): ResolveResult {
  if (pending === "g") {
    if (isPlain(stroke) && stroke.key === "g") return { action: "firstPage", pending: null };
    // Fall through so the stroke still gets its own chance to match
  }

  if (!isPlain(stroke)) return NOTHING;

  switch (stroke.key) {
    case "l":
      return { action: pageToward("right", direction), pending: null };
    case "h":
      return { action: pageToward("left", direction), pending: null };
    case "j":
      return { action: "scrollDown", pending: null };
    case "k":
      return { action: "scrollUp", pending: null };
    case "t":
      return { action: "toggleOutline", pending: null };
    case "G":
      return { action: "lastPage", pending: null };
    // vim's own search. Only vim's: emacs' C-s is the browser's save, and
    // taking a key the browser answers is not something to do unasked.
    case "/":
      return { action: "openSearch", pending: null };
    case "g":
      return { action: null, pending: "g" };
    default:
      return NOTHING;
  }
}

function resolveEmacs(stroke: KeyStroke, pending: string | null): ResolveResult {
  if (pending === "C-c") {
    if (isPlain(stroke) && stroke.key === "t") {
      return { action: "toggleOutline", pending: null };
    }
    // Fall through so the stroke still gets its own chance to match
  }

  // As in emacs itself, where C-f / C-b move by character and C-n / C-p by
  // line: the page is what the character is here, and scrolling what the line
  // is. Forward and back name no side of the screen, so they keep their
  // meaning whichever way the book opens.
  if (isCtrl(stroke, "f")) return { action: "nextPage", pending: null };
  if (isCtrl(stroke, "b")) return { action: "prevPage", pending: null };
  if (isCtrl(stroke, "n")) return { action: "scrollDown", pending: null };
  if (isCtrl(stroke, "p")) return { action: "scrollUp", pending: null };
  if (isCtrl(stroke, "c")) return { action: null, pending: "C-c" };
  if (isAlt(stroke, "<")) return { action: "firstPage", pending: null };
  if (isAlt(stroke, ">")) return { action: "lastPage", pending: null };

  return NOTHING;
}

/**
 * Map a key stroke to a viewer action for the active mode.
 *
 * Two-stroke bindings (vim `gg`, emacs `C-c t`) are handled by carrying a
 * `pending` prefix between calls. The prefix is dropped as soon as a stroke
 * does not complete it — there is no timer, so the behaviour is deterministic.
 *
 * The arrows are answered first, whatever the mode, and an arrow drops any
 * pending prefix along with it: it did not complete the sequence.
 *
 * `direction` is the way the open book's pages turn. It decides only the keys
 * that point at a side of the screen (←/→, vim's h/l).
 */
export function resolveAction(
  mode: KeybindingMode,
  stroke: KeyStroke,
  pending: string | null,
  direction: PageDirection = "ltr",
): ResolveResult {
  const arrow = resolveArrows(stroke, direction);
  if (arrow) return { action: arrow, pending: null };

  switch (mode) {
    case "vim":
      return resolveVim(stroke, pending, direction);
    case "emacs":
      return resolveEmacs(stroke, pending);
    case "none":
      return NOTHING;
  }
}

/**
 * The arrow keys, listed apart from the modes because they answer in all of
 * them. Kept out of `KEYBINDING_HELP` so the same two rows are not written
 * three times over.
 */
export const ARROW_KEYBINDING_HELP: [string, string][] = [
  ["←/→", "前 / 次のページ"],
  ["↑/↓", "スクロール"],
];

/** Key list shown in the settings menu so the bindings are discoverable. */
export const KEYBINDING_HELP: Record<Exclude<KeybindingMode, "none">, [string, string][]> = {
  vim: [
    ["l", "次のページ"],
    ["h", "前のページ"],
    ["j", "下にスクロール"],
    ["k", "上にスクロール"],
    ["t", "目次の開閉"],
    ["/", "本文を検索"],
    ["gg", "最初のページ"],
    ["G", "最後のページ"],
  ],
  emacs: [
    ["C-f", "次のページ"],
    ["C-b", "前のページ"],
    ["C-n", "下にスクロール"],
    ["C-p", "上にスクロール"],
    ["C-c t", "目次の開閉"],
    ["M-<", "最初のページ"],
    ["M->", "最後のページ"],
  ],
};

/**
 * The keys the settings menu lists, worded for the book that is open: in one
 * that opens on the right, ← and h turn to the next page, and the list says
 * so rather than describing a book the reader is not reading.
 *
 * The arrows first because they hold in every mode, the chosen mode's own
 * keys under them — including when that choice is to have none.
 */
export function keybindingHelp(
  mode: KeybindingMode,
  direction: PageDirection = "ltr",
): [string, string][] {
  const help = [...ARROW_KEYBINDING_HELP, ...(mode === "none" ? [] : KEYBINDING_HELP[mode])];
  if (direction === "ltr") return help;

  return help.map(([keys, description]): [string, string] => {
    switch (keys) {
      case "←/→":
        return [keys, "次 / 前のページ"];
      case "l":
        return [keys, "前のページ"];
      case "h":
        return [keys, "次のページ"];
      default:
        return [keys, description];
    }
  });
}
