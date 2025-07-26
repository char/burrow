import { assert } from "../_deps.ts";

export type AtUri = `at://${string}`;
export function isAtUri(s: string): s is AtUri {
  return s.startsWith("at://");
}

export const atUri = (strings: TemplateStringsArray, ...args: unknown[]): AtUri => {
  let uri: string = "at://";
  for (let i = 0; i < strings.length; i++) {
    uri += strings[i];
    const v = args[i];
    if (v !== undefined) uri += String(v);
  }
  assert(isAtUri(uri));
  return uri;
};
