import { Did } from "./did.ts";

const handleCache = new Map<string, { did: Did; expiresAt: number }>();

export async function resolveHandle(handle: string): Promise<Did | undefined> {
  const cached = handleCache.get(handle);
  if (cached && Date.now() <= cached.expiresAt) return cached.did;

  // TODO: simultaneously DoH TXT _atproto.<handle> and https://<handle>/.well-known/atproto-did

  throw new Error("NYI");
}
