export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors: Record<string, string[]> = {},
    public recovery: string | null = null,
  ) {
    super(message);
  }
}
export function invariant(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export const assertVersion = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new AppError(
      409,
      'STALE_VERSION',
      'Данные изменились в другом окне. Загрузите актуальную версию; ваши правки можно применить повторно.',
      {},
      'refetch',
    );
};
