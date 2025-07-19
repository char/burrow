// deno-lint-ignore-file ban-types no-explicit-any

// charlotte typescript idiolect :)

const augment = (proto: Object, name: string, value: unknown) =>
  Object.defineProperty(proto, name, { value, enumerable: false });

function tap<T>(this: T, f: (value: T) => any): T {
  f(this);
  return this;
}

function pipe<T, R>(this: T, f: (value: T) => R): R {
  return f(this);
}

declare global {
  interface Object {
    $tap: typeof tap;
    $pipe: typeof pipe;
    get $json(): string;
  }
}

augment(Object.prototype, "$tap", tap);
augment(Object.prototype, "$pipe", pipe);
Object.defineProperty(Object.prototype, "$json", {
  get: function () {
    return JSON.stringify(this);
  },
  enumerable: false,
});

function mapErr<T, R>(this: Promise<T>, f: (err: unknown) => R): Promise<T> {
  return this.catch(err => {
    throw f(err);
  });
}

declare global {
  interface Promise<T> {
    $mapErr: typeof mapErr;
  }
}

augment(Promise.prototype, "$mapErr", mapErr);
