import { j } from "../_deps.ts";
import { CidSchema } from "./cid.ts";

export const BlobRefSchema = j.obj({
  $type: j.literal("blob"),
  mimeType: j.string,
  ref: j.obj({
    // needs to be string for compatibility with atcute CidLink
    $link: CidSchema as j.CustomSchema<string>,
  }),
  size: j.number,
});
const parseBlobRef = j.compile(BlobRefSchema);
export type BlobRef = j.Infer<typeof BlobRefSchema>;

export function isBlobRef(v: unknown): v is BlobRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "$type" in v &&
    v.$type === "blob" &&
    parseBlobRef(v).errors === undefined
  );
}

export function findBlobRefs(obj: object): BlobRef[] {
  const refs: BlobRef[] = [];
  const queue: object[] = [obj];
  while (true) {
    const obj = queue.shift();
    if (!obj) break;

    for (const v of Object.values(obj)) {
      if (isBlobRef(v)) refs.push(v);
      else if (typeof v === "object" && v !== null) queue.push(v);
    }
  }
  return refs;
}
