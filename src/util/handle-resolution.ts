import { runWithTimeout } from "./async.ts";
import { Did, isDid } from "./did.ts";

const handleCache = new Map<string, { did: Did; expiresAt: number }>();

export async function resolveHandle(handle: string): Promise<Did | undefined> {
  const cached = handleCache.get(handle);
  if (cached && Date.now() <= cached.expiresAt) return cached.did;

  const results = await Promise.allSettled([
    fetch(
      new URL("https://dns.google/resolve").$tap(u => {
        u.searchParams.set("name", "_atproto." + handle);
        u.searchParams.set("type", "TXT");
        u.searchParams.set("cd", "1");
      }),
    )
      .then(r => r.json())
      .then(r => (r.Status === 0 ? (r.Answer.data as string) : undefined))
      .then(txt => txt && /"did=(.*)"/.exec(txt)?.[1])
      .then(did => (isDid(did) ? did : undefined))
      .$pipe(it => runWithTimeout(it, 5000)),
    fetch(
      new URL("https://example.com/.well-known/atproto-did").$tap(u => {
        u.hostname = handle;
      }),
    )
      .then(r => r.text())
      .then(txt => txt.trim())
      .then(did => (isDid(did) ? did : undefined))
      .$pipe(it => runWithTimeout(it, 5000)),
  ]);

  return results
    .filter(it => it.status === "fulfilled")
    .map(it => it.value)
    .at(0);
}
