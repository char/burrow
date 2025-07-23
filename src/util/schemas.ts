import { j } from "../_deps.ts";

export const prefixedStringSchema = <P extends string>(prefix: P) =>
  j.custom(
    (v): v is `${P}${string}` => typeof v === "string" && v.startsWith(prefix),
    "must be a string that starts with " + prefix.$json,
  );

export const urlSchema = j.custom(
  (v): v is string => typeof v === "string" && URL.canParse(v),
  "must be an url",
);
