export interface RuntimeDiagnostics {
  lastSuccessfulTickAt?: string;
  consecutiveTickFailures: number;
  lastTickError?: string;
}

export interface TickResult {
  ok: boolean;
  diagnostics: RuntimeDiagnostics;
}

export async function runOperatorTick(
  action: () => Promise<void>,
  previous: RuntimeDiagnostics,
  log: (message: string) => void = console.log,
  now = Date.now(),
): Promise<TickResult> {
  try {
    await action();
    return {
      ok: true,
      diagnostics: {
        lastSuccessfulTickAt: new Date(now).toISOString(),
        consecutiveTickFailures: 0,
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    log(`operator tick failed: ${message}`);
    return {
      ok: false,
      diagnostics: {
        ...(previous.lastSuccessfulTickAt
          ? { lastSuccessfulTickAt: previous.lastSuccessfulTickAt }
          : {}),
        consecutiveTickFailures: previous.consecutiveTickFailures + 1,
        lastTickError: message,
      },
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}
