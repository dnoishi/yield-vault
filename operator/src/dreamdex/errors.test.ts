import { describe, expect, it } from "vitest";
import {
  INCORRECT_ORDER_SELECTOR,
  INCORRECT_SENDER_SELECTOR,
  INSUFFICIENT_BALANCE_SELECTOR,
  POST_ONLY_WOULD_CROSS_SELECTOR,
  TransientDreamDexError,
  isDreamDexError,
  isInsufficientBalanceError,
  isStaleOrderError,
  isTransientDreamDexError,
} from "./errors.js";

describe("DreamDEX error classification", () => {
  it("finds selectors in nested viem-style causes", () => {
    const error = {
      message: "contract call reverted",
      cause: { cause: { data: `${INCORRECT_ORDER_SELECTOR}00` } },
    };
    expect(isDreamDexError(error, INCORRECT_ORDER_SELECTOR)).toBe(true);
    expect(isTransientDreamDexError(error)).toBe(true);
  });

  it("recognizes typed post-only races", () => {
    expect(
      isTransientDreamDexError(
        new TransientDreamDexError(
          "PostOnlyWouldCross",
          POST_ONLY_WOULD_CROSS_SELECTOR,
        ),
      ),
    ).toBe(true);
  });

  it("recognizes stale cancel errors without making them globally transient", () => {
    const error = { raw: INCORRECT_SENDER_SELECTOR };
    expect(isStaleOrderError(error)).toBe(true);
    expect(isTransientDreamDexError(error)).toBe(false);
  });

  it("recognizes insufficient balance as a genuine placement error", () => {
    const error = { cause: { raw: `${INSUFFICIENT_BALANCE_SELECTOR}00` } };
    expect(isInsufficientBalanceError(error)).toBe(true);
    expect(isTransientDreamDexError(error)).toBe(false);
  });

  it("finds selector-only data inside nested viem payloads", () => {
    const error = {
      cause: {
        data: {
          cause: {
            metaMessages: [
              "Unable to decode parameterized custom error",
              { raw: INCORRECT_SENDER_SELECTOR },
            ],
          },
        },
      },
    };

    expect(isStaleOrderError(error)).toBe(true);
  });

  it("handles cyclic viem causes and message arrays", () => {
    const error: {
      cause?: unknown;
      metaMessages: unknown[];
    } = {
      metaMessages: [42, POST_ONLY_WOULD_CROSS_SELECTOR],
    };
    error.cause = error;

    expect(isTransientDreamDexError(error)).toBe(true);
  });

  it("does not classify unknown failures as transient", () => {
    expect(isTransientDreamDexError({ data: "0xdeadbeef" })).toBe(false);
    expect(isTransientDreamDexError(new Error("RPC unavailable"))).toBe(false);
  });
});
