import { Application, Status } from "@oak/oak";
import { range, responseRange } from "jsr:@oak/commons/range";
import { CidLink, j } from "../../_deps.ts";
import { apiAuthenticationInfo } from "../../auth.ts";
import { mainDb } from "../../db/main_db.ts";
import { openRepository } from "../../repo.ts";
import { BlobRef } from "../../util/blob-ref.ts";
import { CidSchema } from "../../util/cid.ts";
import { DidSchema } from "../../util/did.ts";
import { XRPCError, XRPCRouter } from "../../xrpc-server.ts";

export function setupBlobRoutes(_app: Application, xrpc: XRPCRouter) {
  xrpc.query(
    {
      method: "com.atproto.sync.listBlobs",
      params: {
        did: DidSchema,
        since: j.optional(j.string),
        limit: j.optional(j.number),
        cursor: j.optional(j.string),
      },
    },
    async (_ctx, opts) => {
      const account = mainDb.getAccount(opts.params.did);
      if (!account)
        throw new XRPCError("RepoNotFound", `Could not find repo for did: ${opts.params.did}`);
      const repo = await openRepository(account.did);
      const cids = repo.storage.listBlobs(opts.params.limit ?? 500, opts.params.cursor);
      return { cursor: cids.at(-1), cids };
    },
  );

  xrpc.procedure({ method: "com.atproto.repo.uploadBlob" }, async ctx => {
    const auth = apiAuthenticationInfo.get(ctx.request);
    if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
    const repo = await openRepository(auth.did);

    const body = ctx.request.body.stream;
    if (!body) throw new XRPCError("InvalidRequest", "uploadBlob missing body");
    const size = ctx.request.headers.get("content-length")?.$pipe(Number);
    if (!size || !Number.isSafeInteger(size))
      throw new XRPCError("InvalidRequest", "uploadBlob body indeterminate size");
    const mimeType = ctx.request.headers.get("content-type") ?? "application/octet-stream";
    const blobId = repo.storage.createBlob(null, mimeType, size);
    if (!blobId) throw new Error("unreachable");
    const cid = await repo.storage.writeBlob(blobId, body);

    return {
      blob: { $type: "blob", mimeType, ref: CidLink.fromCid(cid), size } satisfies BlobRef,
    };
  });

  xrpc.query(
    {
      method: "com.atproto.sync.getBlob",
      params: { did: DidSchema, cid: CidSchema },
    },
    async (ctx, opts) => {
      const account = mainDb.getAccount(opts.params.did);
      if (!account)
        throw new XRPCError("RepoNotFound", `Could not find repo for did: ${opts.params.did}`);
      const repo = await openRepository(account.did);

      const blob = repo.storage.getBlob(opts.params.cid);
      if (blob === undefined) throw new XRPCError("InvalidRequest", "Blob not found");
      const data = repo.storage.db.openBlob({
        table: "blobs",
        row: blob.rowid,
        column: "data",
      });
      ctx.response.addResource(data);

      const rangeRes = await range(ctx.request.source!, { size: data.byteLength, mtime: null });
      if (!rangeRes.ok) {
        ctx.response.status = Status.RequestedRangeNotSatisfiable;
        ctx.response.type = "application/json";
        ctx.response.body = {
          error: "InvalidRequest",
          message: "Range header not satisfiable",
        };
        return;
      }

      // TODO: ETag? If-Modified-Since?

      ctx.response.type = blob.mime;

      if (rangeRes.ranges) {
        ctx.response.status = Status.PartialContent;
        ctx.response.with(
          responseRange(
            data.readable,
            data.byteLength,
            rangeRes.ranges,
            { headers: ctx.response.headers, status: ctx.response.status },
            { type: ctx.response.type },
          ),
        );
      } else {
        ctx.response.body = data.readable;
      }
    },
  );
}
