const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const current = inFlight.get(key) as Promise<T> | undefined;

  if (current) {
    return current;
  }

  const next = run().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, next);

  return next;
}
