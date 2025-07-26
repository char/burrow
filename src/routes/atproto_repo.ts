import { Application } from "@oak/oak";
import { assert, j } from "../_deps.ts";
import { openRepository } from "../repo.ts";
import { CidSchema } from "../util/cid.ts";
import { DidSchema, resolveDid } from "../util/did.ts";
import { XRPCError, XRPCRouter } from "../xrpc-server.ts";
import { apiAuthenticationInfo } from "../auth.ts";
import { mainDb } from "../db/main_db.ts";
import { atUri } from "../util/at-uri.ts";
import { resolveHandle } from "../util/handle-resolution.ts";

export function setupRepoRoutes(_app: Application, xrpc: XRPCRouter) {
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

  xrpc.procedure(
    {
      method: "com.atproto.repo.createRecord",
      input: {
        repo: j.string,
        collection: j.string,
        rkey: j.string,
        validate: j.optional(j.boolean),
        record: j.unknown,
        swapCommit: j.optional(CidSchema),
      },
      output: {
        uri: j.string,
        cid: CidSchema,
        commit: j.union(
          j.literal(null),
          j.obj({
            cid: CidSchema,
            rev: j.string,
          }),
        ),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);
      const currentCid = repo.getRecordCid(opts.input.collection, opts.input.rkey);
      const results = await repo.write(
        [
          {
            $type: currentCid
              ? "com.atproto.repo.applyWrites#update"
              : "com.atproto.repo.applyWrites#create",
            rkey: opts.input.rkey,
            collection: opts.input.collection,
            value: opts.input.record,
          },
        ],
        opts.input.swapCommit,
      );

      const firstResult = results.results[0];
      assert(firstResult.$type !== "com.atproto.repo.applyWrites#deleteResult");

      return {
        uri: firstResult.uri,
        cid: firstResult.cid,
        commit: results.commit,
        validationStatus: "valid",
      };
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.putRecord",
      input: {
        repo: j.string,
        collection: j.string,
        rkey: j.string,
        validate: j.optional(j.boolean),
        record: j.unknown,
        swapRecord: j.optional(j.union(j.literal(null), CidSchema)),
        swapCommit: j.optional(CidSchema),
      },
      output: {
        uri: j.string,
        cid: CidSchema,
        commit: j.union(
          j.literal(null),
          j.obj({
            cid: CidSchema,
            rev: j.string,
          }),
        ),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const currentCommit = repo.getCurrCommit()?.data?.toCid();
      if (opts.input.swapCommit && currentCommit !== opts.input.swapCommit)
        throw new XRPCError("InvalidSwap", `Commit was at ${currentCommit ?? "null"}`);

      const currentCid = repo.getRecordCid(opts.input.collection, opts.input.rkey);
      // undefined implies we don't want to check, null implies we want to ensure it didn't exist before
      const swapRecord = opts.input.swapRecord ?? undefined;
      if (opts.input.swapRecord !== undefined && currentCid !== swapRecord)
        throw new XRPCError("InvalidSwap", `Record was at ${currentCid ?? "null"}`);

      const results = await repo.write([
        {
          $type: currentCid
            ? "com.atproto.repo.applyWrites#update"
            : "com.atproto.repo.applyWrites#create",
          rkey: opts.input.rkey,
          collection: opts.input.collection,
          value: opts.input.record,
        },
      ]);

      const firstResult = results.results[0];
      assert(firstResult.$type !== "com.atproto.repo.applyWrites#deleteResult");

      return {
        uri: firstResult.uri,
        cid: firstResult.cid,
        commit: results.commit,
        validationStatus: "valid",
      };
    },
  );

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
      method: "com.atproto.repo.listRecords",
      params: {
        repo: DidSchema,
        collection: j.string,
        limit: j.optional(j.number),
        cursor: j.optional(j.string),
        reverse: j.optional(j.boolean),
      },
      output: {
        cursor: j.string,
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
      return { cursor: "", records: repo.listRecords(opts.params.collection) };
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.applyWrites",
      input: {
        repo: j.string,
        validate: j.optional(j.boolean),
        swapCommit: j.optional(CidSchema),
        writes: j.array(
          j.discriminatedUnion("$type", [
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#create"),
              collection: j.string,
              rkey: j.optional(j.string),
              value: j.unknown,
            }),
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#update"),
              collection: j.string,
              rkey: j.string,
              value: j.unknown,
            }),
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#delete"),
              collection: j.string,
              rkey: j.string,
            }),
          ]),
        ),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const currentCommit = repo.getCurrCommit()?.data?.toCid();
      if (opts.input.swapCommit && currentCommit !== opts.input.swapCommit)
        throw new XRPCError("InvalidSwap", `Commit was at ${currentCommit ?? "null"}`);

      return await repo.write(opts.input.writes);
    },
  );
}
