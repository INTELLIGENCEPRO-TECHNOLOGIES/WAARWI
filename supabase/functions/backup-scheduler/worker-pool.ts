export async function forEachWithConcurrency<T>(
  values: readonly T[],
  maximum: number,
  processValue: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(values.length, Math.max(1, Math.floor(maximum))) },
    async () => {
      while (next < values.length) {
        const value = values[next++];
        await processValue(value);
      }
    },
  );
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
}
