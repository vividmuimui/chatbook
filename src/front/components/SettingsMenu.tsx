// oxlint-disable-next-line no-restricted-imports -- document への keydown / mousedown 購読 (Escape と外側クリックで閉じる) に必要
import { useState, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { keybindingModeAtom } from "../atoms/settingsAtom";
import { useWebSearchAtom } from "../atoms/settingsAtom";
import { keybindingHelp, type KeybindingMode } from "../lib/keybindings";
import { useServerConfig } from "../hooks/useServerConfig";
import { usePageDirection, type SavePageDirection } from "../hooks/usePageDirection";
import type { PageDirection } from "../../shared/schemas/book";

const MODE_LABELS: Record<KeybindingMode, string> = {
  none: "なし",
  vim: "Vim",
  emacs: "Emacs",
};

const DIRECTION_LABELS: Record<PageDirection, string> = {
  ltr: "左開き",
  rtl: "右開き",
};

interface SettingsMenuProps {
  /**
   * The book open in the reader, whose own settings — which way its pages turn
   * — the menu offers along with the reader's. None where no book is open.
   */
  pdfId?: string;
  /** Injectable so a direction the server refused can be driven in a test. */
  savePageDirection?: SavePageDirection;
}

/**
 * The reader's settings. Logging out is not here but on the shelf's menu
 * (`ShelfSettingsMenu`): the shelf is one tap away, and one way out is easier
 * to find than two.
 */
export function SettingsMenu({ pdfId, savePageDirection }: SettingsMenuProps = {}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useAtom(keybindingModeAtom);
  const [useWebSearch, setUseWebSearch] = useAtom(useWebSearchAtom);
  const { webSearchAvailable } = useServerConfig();
  const pageDirection = usePageDirection(pdfId, savePageDirection);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  // Worded for the book that is open: in one that opens on the right, ← and h
  // are the way on.
  const help = keybindingHelp(mode, pageDirection.direction ?? "ltr");

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="設定"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-200 cursor-pointer"
      >
        ⚙
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          {/* Hidden rather than disabled when the provider has no web search:
              the server turns such a request into an ordinary one anyway, so a
              switch here would be one the reader could flip to no effect. */}
          {webSearchAvailable ? (
            <fieldset className="mb-3 border-b border-gray-100 pb-3">
              <legend className="mb-2 text-xs font-semibold text-gray-500">チャット</legend>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={useWebSearch}
                  onChange={(e) => setUseWebSearch(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Web検索
              </label>
            </fieldset>
          ) : null}

          {/* The book's own setting rather than the reader's: kept with the
              book on the server, so every device turns it the same way. Not
              offered until the book has said which way it turns. Any format:
              an EPUB keeps the choice for when its pages turn too. */}
          {pageDirection.direction !== null && (
            <fieldset className="mb-3 border-b border-gray-100 pb-3">
              <legend className="mb-2 text-xs font-semibold text-gray-500">ページめくり</legend>
              <div className="flex gap-1">
                {(Object.keys(DIRECTION_LABELS) as PageDirection[]).map((value) => (
                  <label
                    key={value}
                    className="flex flex-1 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="radio"
                      name="page-direction"
                      value={value}
                      checked={pageDirection.direction === value}
                      disabled={pageDirection.saving}
                      onChange={() => void pageDirection.changeDirection(value)}
                      className="h-3.5 w-3.5"
                    />
                    {DIRECTION_LABELS[value]}
                  </label>
                ))}
              </div>
              {pageDirection.error !== null && (
                <p role="alert" className="px-1 pt-1 text-xs text-red-600">
                  ページめくりの向きを保存できませんでした: {pageDirection.error}
                </p>
              )}
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-gray-500">キーバインド</legend>
            <div className="flex flex-col gap-1">
              {(Object.keys(MODE_LABELS) as KeybindingMode[]).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="keybinding-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="h-3.5 w-3.5"
                  />
                  {MODE_LABELS[value]}
                </label>
              ))}
            </div>
          </fieldset>

          <dl className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600">
            {help.map(([keys, description]) => (
              <div key={keys} className="flex items-baseline justify-between py-0.5">
                <dt>
                  <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px]">
                    {keys}
                  </kbd>
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
