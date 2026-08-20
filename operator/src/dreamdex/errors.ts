export const INCORRECT_ORDER_SELECTOR = "0x8080c2ed";
export const POST_ONLY_WOULD_CROSS_SELECTOR = "0x7cf05fcb";
export const INSUFFICIENT_BALANCE_SELECTOR = "0xcf479181";
export const INCORRECT_SENDER_SELECTOR = "0xf5e39c1f";

type TransientDreamDexErrorName =
  | "IncorrectOrder"
  | "PostOnlyWouldCross";

export class TransientDreamDexError extends Error {
  readonly selector: string;

  constructor(
    readonly errorName: TransientDreamDexErrorName,
    selector: string,
    options?: ErrorOptions,
  ) {
    super(errorName, options);
    this.name = "TransientDreamDexError";
    this.selector = selector;
  }
}

export function isDreamDexError(error: unknown, selector: string): boolean {
  const expected = selector.toLowerCase();
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  const nestedFields = [
    "cause",
    "data",
    "raw",
    "signature",
    "details",
    "message",
    "shortMessage",
    "metaMessages",
  ] as const;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "string") {
      if (current.toLowerCase().includes(expected)) return true;
      continue;
    }
    if (typeof current !== "object") continue;

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    const value = current as Record<PropertyKey, unknown>;
    for (const key of nestedFields) {
      try {
        pending.push(value[key]);
      } catch {
        // Ignore inaccessible properties on third-party error objects.
      }
    }
    for (const symbol of Object.getOwnPropertySymbols(current)) {
      try {
        pending.push(value[symbol]);
      } catch {
        // Viem and Node errors can expose causes through symbol properties.
      }
    }
  }
  return false;
}

export function isTransientDreamDexError(
  error: unknown,
): error is TransientDreamDexError {
  return (
    error instanceof TransientDreamDexError ||
    isDreamDexError(error, INCORRECT_ORDER_SELECTOR) ||
    isDreamDexError(error, POST_ONLY_WOULD_CROSS_SELECTOR)
  );
}

export function isStaleOrderError(error: unknown): boolean {
  return (
    isDreamDexError(error, INCORRECT_ORDER_SELECTOR) ||
    isDreamDexError(error, INCORRECT_SENDER_SELECTOR)
  );
}

export function isInsufficientBalanceError(error: unknown): boolean {
  return isDreamDexError(error, INSUFFICIENT_BALANCE_SELECTOR);
}
