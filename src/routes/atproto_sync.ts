import { Application } from "@oak/oak";
import { XRPCError, XRPCRouter } from "../xrpc-server.ts";
import { CBOR, CidLink, j, varint } from "../_deps.ts";
import { DidSchema } from "../util/did.ts";
import { CidSchema } from "../util/cid.ts";
import { openRepository } from "../repo.ts";
import { mainDb } from "../db/main_db.ts";
import { findKey } from "../mst.ts";
import { toCidLink } from "@atcute/cbor";
import { concat } from "@atcute/uint8array";

export function setupSyncRoutes(_app: Application, xrpc: XRPCRouter) {
  xrpc.query(
    {
      method: "com.atproto.sync.listRepos",
      params: {
        limit: j.optional(j.number),
        cursor: j.optional(j.string),
      },
      output: {
        cursor: j.string,
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
      return { cursor: "", repos };
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

      const blocks = findKey(
        repo.storage,
        root.data.toCid(),
        opts.params.collection + "/" + opts.params.rkey,
      );

      const recordCid = repo.getRecordCid(opts.params.collection, opts.params.rkey);
      if (!recordCid) throw new XRPCError("RecordNotFound", `Could not find record`);
      const recordBlock = recordCid?.$pipe(repo.storage.getBlock);
      if (!recordCid || !recordBlock)
        throw new XRPCError("RecordNotFound", `Could not find record`);
      blocks.push([recordCid, recordBlock]);

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

      return undefined;
    },
  );
}
