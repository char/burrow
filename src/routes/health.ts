import denoJson from "../../deno.json" with { type: "json" };
import { router, xrpc } from "../web.ts";
const VERSION = denoJson.version;

xrpc.query({ method: "_health" }, () => ({ version: "burrow " + VERSION }));

router.get("/", ctx => {
  ctx.response.type = "text/plain; charset=utf-8";
  ctx.response.body = `burrow pds version ${VERSION}

 /)/)
( . .)
( づ♡

this is an atproto PDS ^-^ see atproto.com`;
});
