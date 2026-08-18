import { describe, expect, it } from "vitest";
import {
  proximityWeight,
  scoreIncrement,
  snapPriceToMinWeight,
  WEIGHT_AT_ONE_SIGMA,
} from "./yield.js";

describe("yield proximity", () => {
  it("matches Gaussian landmarks", () => {
    expect(proximityWeight(100n, 100n, 10n)).toBe(1);
    expect(proximityWeight(110n, 100n, 10n)).toBeCloseTo(WEIGHT_AT_ONE_SIGMA);
    expect(scoreIncrement(2, 0.5, 10)).toBe(10);
  });

  it("snaps inward without crossing", () => {
    const bid = snapPriceToMinWeight({
      candidate: 70n,
      mid: 100n,
      sigma: 10n,
      minWeight: WEIGHT_AT_ONE_SIGMA,
      tick: 1n,
      isBid: true,
      opposite: 101n,
    });
    expect(bid).toBe(90n);
  });
});
