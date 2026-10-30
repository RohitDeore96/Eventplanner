interface EngineError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngineError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: string, message: string, field?: string): Result<T> {
  const error: EngineError = field === undefined ? { code, message } : { code, message, field };
  return { ok: false, error };
}
