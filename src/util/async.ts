export function runWithTimeout<T>(promise: Promise<T>, delay: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out")), delay);
    promise.then(
      value => (clearTimeout(timeout), resolve(value)),
      value => (clearTimeout(timeout), reject(value)),
    );
  });
}
