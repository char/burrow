type ResultData<T> = [ok: T, err: undefined] | [ok: undefined, err: Error];
export type Result<T> = ([ok: T, err: undefined] | [ok: undefined, err: Error]) & {
  unwrap(mapError?: (orig: Error) => Error): T;
};

function result_unwrap<T>(this: Result<T>, mapError?: (orig: Error) => Error): T {
  if (this[0]) return this[0];
  if (mapError) throw mapError(this[1]!);
  throw this[1];
}

function createResult<T>(data: ResultData<T>): Result<T> {
  const result = [...data] as Result<T>;
  Reflect.defineProperty(result, "unwrap", {
    value: result_unwrap,
    enumerable: false,
  });
  return result;
}

// deno-lint-ignore no-explicit-any
export function safely<Args extends any[], T>(
  f: (...args: Args) => T,
): (...args: Args) => Result<T> {
  return (...args) => {
    let resultData: ResultData<T>;
    try {
      resultData = [f(...args), undefined];
    } catch (err) {
      resultData = [undefined, err as Error];
    }
    return createResult(resultData);
  };
}

export function throwExpr(err: Error): never {
  throw err;
}
