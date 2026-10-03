// oxlint-disable-next-line no-restricted-imports -- document への keydown / mousedown 購読 (Escape と外側クリックで閉じる) に必要
import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { epubTypographyAtom } from "../../atoms/settingsAtom";
import {
  DEFAULT_EPUB_TYPOGRAPHY,
  EPUB_FONT_SIZES_PX,
  stepFontSize,
  type EpubFontFamily,
  type EpubLineHeight,
  type EpubMargin,
  type EpubTextAlign,
  type EpubTypography,
} from "../../lib/epubTypography";

const LINE_HEIGHT_LABELS: Record<EpubLineHeight, string> = {
  tight: "狭い",
  snug: "やや狭い",
  normal: "標準",
  loose: "広い",
};

const TEXT_ALIGN_LABELS: Record<EpubTextAlign, string> = {
  start: "左揃え",
  justify: "両端揃え",
};

const FONT_FAMILY_LABELS: Record<EpubFontFamily, string> = {
  sans: "ゴシック",
  serif: "明朝",
};

const MARGIN_LABELS: Record<EpubMargin, string> = {
  narrow: "狭い",
  normal: "標準",
  wide: "広い",
};

const stepButtonClass =
  "flex h-9 w-12 cursor-pointer items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:opacity-40";

/**
 * The 「Aa」 menu of an EPUB: how large, how far apart, how aligned and in
 * which face its text is drawn, and how much margin the page keeps. Every
 * change is drawn at once and kept for every EPUB the reader opens.
 *
 * Only an EPUB has one: a PDF's type is part of its pages.
 */
export function EpubTypographyMenu() {
  const [open, setOpen] = useState(false);
  const [typography, setTypography] = useAtom(epubTypographyAtom);
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

  const change = (next: Partial<EpubTypography>) => setTypography({ ...typography, ...next });
  const size = EPUB_FONT_SIZES_PX[typography.fontSizeStep];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="表示の設定"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-1 text-base leading-none font-semibold text-gray-600 hover:bg-gray-200 cursor-pointer"
      >
        Aa
      </button>

      {open && (
        // Held inside the window on a phone, where the header leaves the menu
        // less room to the left of its button than it has on a wide screen.
        <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <fieldset className="mb-3">
            <legend className="mb-2 text-xs font-semibold text-gray-500">文字の大きさ</legend>
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="文字を小さく"
                disabled={typography.fontSizeStep === 0}
                onClick={() => setTypography(stepFontSize(typography, -1))}
                className={`${stepButtonClass} text-sm`}
              >
                A
              </button>
              <output aria-label="文字の大きさ" className="text-sm text-gray-700 tabular-nums">
                {typography.fontSizeStep + 1} / {EPUB_FONT_SIZES_PX.length}
                <span className="ml-1 text-xs text-gray-400">({size}px)</span>
              </output>
              <button
                type="button"
                aria-label="文字を大きく"
                disabled={typography.fontSizeStep === EPUB_FONT_SIZES_PX.length - 1}
                onClick={() => setTypography(stepFontSize(typography, 1))}
                className={`${stepButtonClass} text-xl`}
              >
                A
              </button>
            </div>
          </fieldset>

          <Choices
            legend="行間"
            name="epub-line-height"
            labels={LINE_HEIGHT_LABELS}
            value={typography.lineHeight}
            onChange={(lineHeight) => change({ lineHeight })}
          />
          <Choices
            legend="配置"
            name="epub-text-align"
            labels={TEXT_ALIGN_LABELS}
            value={typography.textAlign}
            onChange={(textAlign) => change({ textAlign })}
          />
          <Choices
            legend="フォント"
            name="epub-font-family"
            labels={FONT_FAMILY_LABELS}
            value={typography.fontFamily}
            onChange={(fontFamily) => change({ fontFamily })}
          />
          <Choices
            legend="余白"
            name="epub-margin"
            labels={MARGIN_LABELS}
            value={typography.margin}
            onChange={(margin) => change({ margin })}
          />

          <div className="border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => setTypography(DEFAULT_EPUB_TYPOGRAPHY)}
              className="w-full rounded px-1 py-1 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              既定に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One row of mutually exclusive choices, drawn as a segmented control. */
function Choices<T extends string>({
  legend,
  name,
  labels,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="mb-3">
      <legend className="mb-2 text-xs font-semibold text-gray-500">{legend}</legend>
      <div className="flex overflow-hidden rounded border border-gray-300">
        {(Object.keys(labels) as T[]).map((option) => (
          <label
            key={option}
            className={`flex-1 cursor-pointer border-l border-gray-300 px-1 py-1.5 text-center text-xs first:border-l-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${
              value === option
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
