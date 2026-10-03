import { MAX_ZOOM, MIN_ZOOM } from "./pageScale";
import type { PageDirection } from "../../shared/schemas/book";

/**
 * How the reader's fingers are read on a page they cannot point at.
 *
 * Kept apart from the viewer so the arithmetic can be tested without a touch
 * screen: jsdom has no fingers, and Playwright's has no pinch.
 */

/**
 * How much of each side of the page turns it.
 *
 * The middle is left alone so that a double tap — which the reader spends on
 * the zoom — cannot be spent as two page turns on the way there.
 */
export const TAP_EDGE = 0.3;

/** Far enough that a finger meant to travel, rather than resting unevenly. */
const SWIPE_MIN_DISTANCE = 64;

/**
 * How much straighter across than down a swipe has to be.
 *
 * A page is read by scrolling down it, and a thumb scrolling down drifts
 * sideways. Anything but a decidedly sideways travel belongs to the scroll.
 */
const SWIPE_STRAIGHTNESS = 1.6;

/** Past this a finger is placing the page rather than flicking through it. */
const SWIPE_MAX_MS = 700;

export type PageTurn = "prev" | "next";

/** A side of the screen, as the reader sees it. */
export type ScreenSide = "left" | "right";

/**
 * The page turn that lies toward one side of the screen.
 *
 * The one place a book's direction is read: a book that opens on the left has
 * its next page on the right, and one that opens on the right — set vertically
 * in Japanese, or a manga — has it on the left. Everything that turns pages by
 * where on the screen the reader pointed (the edges, a swipe, ←/→, h/l, the
 * stepper's chevrons) asks here, and what a turn then does is `turnTo`'s,
 * which knows nothing of sides.
 */
export function turnToward(side: ScreenSide, direction: PageDirection): PageTurn {
  const nextSide: ScreenSide = direction === "rtl" ? "left" : "right";
  return side === nextSide ? "next" : "prev";
}

/** What a tap at this share of the way across the page is for. */
export function resolveTapZone(
  relativeX: number,
  direction: PageDirection = "ltr",
): PageTurn | "zoom" {
  if (relativeX < TAP_EDGE) return turnToward("left", direction);
  if (relativeX > 1 - TAP_EDGE) return turnToward("right", direction);
  return "zoom";
}

interface Swipe {
  dx: number;
  dy: number;
  durationMs: number;
}

/**
 * The page turn a finger's travel asked for, or nothing if it asked for none.
 *
 * A finger travelling left pulls in the page that was on the right, as a sheet
 * of paper does — which is the next page in a book that opens on the left, and
 * the previous one in a book that opens on the right.
 */
export function resolveSwipe(
  { dx, dy, durationMs }: Swipe,
  direction: PageDirection = "ltr",
): PageTurn | null {
  if (durationMs > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_STRAIGHTNESS) return null;
  return turnToward(dx < 0 ? "right" : "left", direction);
}

/**
 * The zoom a pinch leaves behind, from how much further apart the fingers are
 * than when they landed.
 *
 * Measured against the zoom the pinch started at rather than the one before it,
 * so a gesture that goes out and comes back ends where it began.
 */
export function pinchZoom(startZoom: number, ratio: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * ratio));
}
