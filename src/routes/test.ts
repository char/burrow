import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { TID } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { mainDb } from "../db/main_db.ts";
import { openRepoDatabase } from "../db/repo_storage.ts";
import { Repository } from "../repo.ts";
import { router } from "../web.ts";

if (appConfig.adminPassword) {
  router.post("/test/create-account", async ctx => {
    if (ctx.request.headers.get("Authorization") !== `Bearer ${appConfig.adminPassword}`) {
      ctx.response.body = "Unauthorized";
      ctx.response.status = 401;
      return;
    }

    const testDomain = "x-burrow-20250718.tmp.bun.how";

    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    mainDb.createAccount(
      `did:web:testing.${testDomain}`,
      "testing." + testDomain,
      "testing@" + testDomain,
      "password",
      signingKey,
    );
    const storage = await openRepoDatabase(`did:web:testing.${testDomain}`);
    const repo = new Repository(storage, signingKey);
    await repo.initialCommit();

    const record = {
      $type: "how.bun.example.record",
      hello: "world",
    };
    const rkey = TID.now();
    await repo.write([
      {
        $type: "com.atproto.repo.applyWrites#create",
        collection: record.$type,
        rkey,
        value: record,
      },
    ]);

    ctx.response.body = ":)";
  });
}
