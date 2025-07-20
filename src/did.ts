import { assert, j } from "./_deps.ts";
import { runWithTimeout } from "./util/async.ts";

export function isDid(did: unknown): did is Did {
  return typeof did === "string" && did.startsWith("did:");
}
export const DidSchema = j.custom(isDid, "must be a did");
export type Did = `did:${string}`;

const VerificationMethodSchema = j.obj({
  id: j.string,
  type: j.string,
  controller: DidSchema,
  publicKeyMultibase: j.optional(j.string),
  publicKeyJwk: j.optional(j.unknown),
});
const StringStringRecordSchema = j.custom(
  (obj): obj is Record<string, string> =>
    typeof obj === "object" &&
    obj !== null &&
    Object.values(obj).every(v => typeof v === "string"),
);
export const DidDocumentSchema = j.obj({
  "@context": j.array(j.string),
  id: DidSchema,
  controller: j.optional(j.union(DidSchema, j.array(DidSchema))),
  alsoKnownAs: j.optional(j.array(j.string)),
  verificationMethod: j.optional(j.array(VerificationMethodSchema)),
  authentication: j.optional(j.array(j.union(j.string, VerificationMethodSchema))),
  service: j.optional(
    j.array(
      j.obj({
        id: j.string,
        type: j.union(j.string, j.array(j.string)),
        serviceEndpoint: j.union(
          j.string,
          StringStringRecordSchema,
          j.array(j.union(j.string, StringStringRecordSchema)),
        ),
      }),
    ),
  ),
});
export type DidDocument = j.Infer<typeof DidDocumentSchema>;
const parseDidDocument = j.compile(DidDocumentSchema);

const DID_CACHE = new Map<Did, { doc: DidDocument; exp: number }>();

export function dropCachedDid(did: Did) {
  DID_CACHE.delete(did);
}

export class DidDocumentInvalid extends Error {
  constructor(
    public did: Did,
    public errors: j.ValidationError[],
  ) {
    super("Failed to resolve did: " + did);
  }
}

const TWELVE_HOURS_MS = 1000 * 60 * 60 * 12;

async function resolveDidPlc(did: Did): Promise<DidDocument> {
  assert(did.startsWith("did:plc:"), "must be did:plc");

  // TODO: support plc replicas
  const response = await fetch(new URL(did, `https://plc.directory`));
  const doc = await response.json();
  const { value, errors } = parseDidDocument(doc);
  if (errors) throw new DidDocumentInvalid(did, errors);
  DID_CACHE.set(did, { doc: value, exp: performance.now() + TWELVE_HOURS_MS });

  return value;
}

async function resolveDidWeb(did: Did): Promise<DidDocument> {
  assert(did.startsWith("did:web:"), "must be did:web");

  const url = new URL("https://example.com/.well-known/did.json");
  const [_did, _web, host, ...path] = did.split(":");

  const [hostname, ...port] = decodeURIComponent(host).split(":");
  url.hostname = hostname;
  url.port = hostname === "localhost" ? (port.at(0) ?? "") : "";

  if (path.length === 0) url.pathname = "/.well-known/did.json";
  else throw new Error(did + ": path-based did:web DIDs are not supported in atproto");
  // else url.pathname = "/" + path.map(decodeURIComponent).join("/") + "/did.json";

  const response = await runWithTimeout(fetch(url), 5000).$mapErr(
    () => new Error(did + ": fetch timed out"),
  );

  const transferEncoding = response.headers.get("transfer-encoding");
  if (transferEncoding === "chunked")
    throw new Error(did + ": `Transfer-Encoding: chunked` is not supported for did:web lookup");

  const contentLength = response.headers.get("content-length");
  if (contentLength === null)
    throw new Error(did + ": Content-Length header was not included with response");
  if (Number(contentLength) > 1024 * 1024)
    throw new Error(did + ": response size exceeded 1MiB");

  const doc = await response.json();
  const { value, errors } = parseDidDocument(doc);
  if (errors) throw new DidDocumentInvalid(did, errors);
  DID_CACHE.set(did, { doc: value, exp: performance.now() + TWELVE_HOURS_MS });

  return value;
}

export async function resolveDid(did: Did, noCache: boolean = false): Promise<DidDocument> {
  if (!noCache) {
    const cached = DID_CACHE.get(did);
    if (cached && cached.exp < performance.now()) {
      return cached.doc;
    }
  }

  if (did.startsWith("did:plc:")) return await resolveDidPlc(did);
  if (did.startsWith("did:web:")) return await resolveDidWeb(did);

  throw new Error("unsupported DID type: " + did);
}
