import { router } from "../web.ts";

router.get("/static/:file*", async ctx => {
  try {
    await ctx.send({ root: "./static", path: ctx.params.file });
  } catch {
    ctx.response.status = 404;
    ctx.response.type = "text/plain";
    ctx.response.body = "Not Found";
  }
});

import "./cookie_auth.ts";
import "./did_web.ts";
import "./oauth.ts";
import "./test.ts";

import "./atproto/blobs.ts";
import "./atproto/repo_queries.ts";
import "./atproto/repo_writes.ts";
import "./atproto/server.ts";
