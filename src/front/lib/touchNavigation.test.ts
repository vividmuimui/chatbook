import { describe, it, expect } from "vite-plus/test";
import { pinchZoom, resolveSwipe, resolveTapZone, TAP_EDGE, turnToward } from "./touchNavigation";
import { MIN_ZOOM, MAX_ZOOM } from "./pageScale";

describe("resolveTapZone", () => {
  it("turns back from a tap on the left edge", () => {
    expect(resolveTapZone(0.1)).toBe("prev");
  });

  it("turns on from a tap on the right edge", () => {
    expect(resolveTapZone(0.9)).toBe("next");
  });

  it("leaves the middle to the zoom, so a double tap is not two page turns", () => {
    expect(resolveTapZone(0.5)).toBe("zoom");
  });

  it("counts the edge itself as the middle, so neither band can turn a tap twice", () => {
    expect(resolveTapZone(TAP_EDGE)).toBe("zoom");
    expect(resolveTapZone(1 - TAP_EDGE)).toBe("zoom");
  });
});

describe("turnToward", () => {
  it("finds the next page on the right of a book that opens on the left", () => {
    expect(turnToward("right", "ltr")).toBe("next");
    expect(turnToward("left", "ltr")).toBe("prev");
  });

  it("finds the next page on the left of a book that opens on the right", () => {
    expect(turnToward("left", "rtl")).toBe("next");
    expect(turnToward("right", "rtl")).toBe("prev");
  });
});

describe("resolveTapZone in a book that opens on the right", () => {
  it("turns on from a tap on the left edge, where the next page is", () => {
    expect(resolveTapZone(0.1, "rtl")).toBe("next");
  });

  it("turns back from a tap on the right edge", () => {
    expect(resolveTapZone(0.9, "rtl")).toBe("prev");
  });

  it("still leaves the middle to the zoom", () => {
    expect(resolveTapZone(0.5, "rtl")).toBe("zoom");
  });
});

describe("resolveSwipe in a book that opens on the right", () => {
  it("turns on when the finger travels right, pulling the next page in from the left", () => {
    expect(resolveSwipe({ dx: 120, dy: 10, durationMs: 200 }, "rtl")).toBe("next");
  });

  it("turns back when the finger travels left", () => {
    expect(resolveSwipe({ dx: -120, dy: 10, durationMs: 200 }, "rtl")).toBe("prev");
  });

  it("reads a scroll as a scroll whichever way the book opens", () => {
    expect(resolveSwipe({ dx: 80, dy: 200, durationMs: 200 }, "rtl")).toBeNull();
  });
});

describe("resolveSwipe", () => {
  it("turns on when the finger travels left across the page", () => {
    expect(resolveSwipe({ dx: -120, dy: 10, durationMs: 200 })).toBe("next");
  });

  it("turns back when the finger travels right across the page", () => {
    expect(resolveSwipe({ dx: 120, dy: 10, durationMs: 200 })).toBe("prev");
  });

  it("reads a scroll down the page as a scroll, however far sideways it wanders", () => {
    expect(resolveSwipe({ dx: -80, dy: 200, durationMs: 200 })).toBeNull();
  });

  it("ignores a nudge too small to have been meant as a swipe", () => {
    expect(resolveSwipe({ dx: -20, dy: 2, durationMs: 200 })).toBeNull();
  });

  it("ignores a finger dragged slowly, which is a reader moving the page about", () => {
    expect(resolveSwipe({ dx: -120, dy: 10, durationMs: 1500 })).toBeNull();
  });
});

describe("pinchZoom", () => {
  it("enlarges the page by however far the fingers spread", () => {
    expect(pinchZoom(1, 2)).toBe(2);
  });

  it("shrinks the page by however far the fingers close", () => {
    expect(pinchZoom(2, 0.5)).toBe(1);
  });

  it("stops enlarging at the largest zoom the viewer offers", () => {
    expect(pinchZoom(MAX_ZOOM, 3)).toBe(MAX_ZOOM);
  });

  it("stops shrinking at the smallest zoom the viewer offers", () => {
    expect(pinchZoom(MIN_ZOOM, 0.1)).toBe(MIN_ZOOM);
  });
});
