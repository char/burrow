import { concat } from "@atcute/uint8array";
import { CBOR, CidLink, j, varint } from "../../_deps.ts";
import { mainDb } from "../../db/main_db.ts";
import { traverseMSTForKey } from "../../mst.ts";
import { openRepository } from "../../repo.ts";
import { atUri } from "../../util/at-uri.ts";
import { CidSchema } from "../../util/cid.ts";
import { DidSchema, resolveDid } from "../../util/did.ts";
import { xrpc } from "../../web.ts";
import { XRPCError } from "../../xrpc-server.ts";

xrpc.query(
  {
    method: "com.atproto.repo.describeRepo",
    params: { repo: DidSchema },
    output: {
      handle: j.string,
      did: DidSchema,
      didDoc: j.unknown,
      collections: j.array(j.string),
      handleIsCorrect: j.boolean,
    },
  },
  async (_ctx, opts) => {
    const account = mainDb.getAccount(opts.params.repo);
    if (!account)
      throw new XRPCError("RepoNotFound", `Could not find repo for DID: ${opts.params.repo}`);

    const repo = await openRepository(account.did);
    const collections = repo.listCollections();
    const didDoc = await resolveDid(account.did);

    return {
      handle: account.handle,
      did: account.did,
      didDoc,
      handleIsCorrect: true,
      collections,
    };
  },
);

xrpc.query(
  {
    method: "com.atproto.repo.getRecord",
    params: {
      repo: DidSchema,
      collection: j.string,
      rkey: j.string,
      cid: j.optional(CidSchema),
    },
  },
  async (_ctx, { params: { repo: did, collection, rkey, cid: requestedCid } }) => {
    const repo = await openRepository(did);
    const record = repo.getRecord(collection, rkey);
    const uri = atUri`${did}/${collection}/${rkey}`;
    const cid = repo.getRecordCid(collection, rkey);
    if (!record || (requestedCid && requestedCid !== cid)) {
      throw new XRPCError("RecordNotFound", "Could not locate record: " + uri);
    }
    return { uri, cid, value: record };
  },
);

xrpc.query(
  {
    method: "com.atproto.repo.listRecords",
    params: {
      repo: DidSchema,
      collection: j.string,
      limit: j.optional(j.number),
      cursor: j.optional(j.string),
      reverse: j.optional(j.boolean),
    },
    output: {
      cursor: j.optional(j.string),
      records: j.array(
        j.obj({
          uri: j.string,
          cid: CidSchema,
          value: j.unknown,
        }),
      ),
    },
  },
  async (_ctx, opts) => {
    // TODO: pagination
    const account = mainDb.getAccount(opts.params.repo);
    if (!account)
      throw new XRPCError("RepoNotFound", `Could not find repo for DID: ${opts.params.repo}`);

    const repo = await openRepository(account.did);
    return { records: repo.listRecords(opts.params.collection) };
  },
);

xrpc.query(
  {
    method: "com.atproto.sync.listRepos",
    params: {
      limit: j.optional(j.number),
      cursor: j.optional(j.string),
    },
    output: {
      cursor: j.optional(j.string),
      repos: j.array(
        j.obj({
          did: DidSchema,
          head: CidSchema,
          rev: j.string,
          active: j.optional(j.boolean),
          status: j.optional(
            j.union(
              j.literal("takendown"),
              j.literal("suspended"),
              j.literal("deleted"),
              j.literal("deactivated"),
              j.literal("desynchronized"),
              j.literal("throttled"),
            ),
          ),
        }),
      ),
    },
  },
  async () => {
    // TODO: paginate

    const repos = [];
    for (const account of mainDb.getAllAccounts()) {
      const repo = await openRepository(account.did);
      const commit = repo.getCurrCommit();
      if (!commit) continue;
      repos.push({
        did: account.did,
        head: commit.data.toCid(),
        rev: commit.rev,
        active: account.deactivated_at === null,
      });
    }
    return { repos };
  },
);

xrpc.query(
  {
    method: "com.atproto.sync.getRecord",
    params: {
      did: DidSchema,
      collection: j.string,
      rkey: j.string,
    },
  },
  async (ctx, opts) => {
    const account = mainDb.getAccount(opts.params.did);
    if (!account)
      throw new XRPCError("RepoNotFound", `Could not find repo for DID: ${opts.params.did}`);
    const repo = await openRepository(account.did);
    const rootCid = repo.storage.getCommit();
    const root = repo.getCurrCommit();
    if (!rootCid || !root)
      throw new XRPCError("RepoNotFound", `Could not find repo for DID: ${opts.params.did}`);

    const blocks = traverseMSTForKey(
      repo.storage,
      root.data.toCid(),
      opts.params.collection + "/" + opts.params.rkey,
    );

    const recordCid = repo.getRecordCid(opts.params.collection, opts.params.rkey);
    const recordBlock = recordCid?.$pipe(repo.storage.getBlock);
    if (recordCid && recordBlock) {
      blocks.push([recordCid, recordBlock]);
    }

    blocks.unshift([rootCid, repo.storage.getBlock(rootCid)!]);

    const parts: Uint8Array[] = [];

    const header = CBOR.encode({ version: 1, roots: [CidLink.fromCid(rootCid)] });
    const headerLen = new Uint8Array(10).$pipe(b =>
      b.subarray(0, varint.encode(header.byteLength, b)),
    );
    parts.push(headerLen, header);
    for (const [cid, data] of blocks) {
      const cidBytes = CidLink.fromCid(cid).bytes;
      const blockLen = new Uint8Array(10).$pipe(b =>
        b.subarray(0, varint.encode(cidBytes.byteLength + data.byteLength, b)),
      );
      parts.push(blockLen, cidBytes, data);
    }

    const car = concat(parts);

    ctx.response.type = "application/vnd.ipld.car";
    ctx.response.status = 200;
    ctx.response.body = car;
  },
);

xrpc.query(
  { method: "com.atproto.sync.getRepoStatus", params: { did: DidSchema } },
  async (_ctx, opts) => {
    const account = mainDb.getAccount(opts.params.did);
    if (!account)
      throw new XRPCError("RepoNotFound", `Could not find repo for DID: ${opts.params.did}`);
    const repo = await openRepository(account.did);
    return {
      did: account.did,
      active: account.deactivated_at === undefined,
      rev: repo.getCurrCommit()?.rev,
    };
  },
);
