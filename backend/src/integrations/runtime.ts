/** One deadline covers the whole operation, including response body reads. */
export async function withDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Integration timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function boundedTimeout(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(30_000, value)) : fallback;
}
