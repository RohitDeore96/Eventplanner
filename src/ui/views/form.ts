/** FormData safety: values may be File objects; the engine only accepts strings. */
export function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
