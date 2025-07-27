import { appConfig } from "../config.ts";
import { mainDb } from "../db/main_db.ts";
import { Did, DidDocument } from "../util/did.ts";
import { router } from "../web.ts";

router.get("/.well-known/did.json", async ctx => {
  const host = ctx.request.headers.get("host");
  const pdsHost = new URL(appConfig.baseUrl).host;
  if (host === pdsHost) {
    return {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: appConfig.did,
    } satisfies DidDocument;
  }

  const did: Did = `did:web:${host}`;
  const account = mainDb.getAccount(did);
  if (!account) {
    ctx.response.body = "Not Found";
    ctx.response.status = 404;
    return;
  }

  const key = await mainDb.getSigningKey(did);
  if (!key) {
    ctx.response.body = "Internal Server Error: no signing key";
    ctx.response.status = 500;
    return;
  }

  ctx.response.type = "application/json";
  ctx.response.body = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      "https://w3id.org/security/suites/secp256k1-2019/v1",
    ],
    id: did,
    alsoKnownAs: ["at://" + account.handle],
    verificationMethod: [
      {
        id: did + "#atproto",
        type: "Multikey",
        controller: did,
        publicKeyMultibase: await key.exportPublicKey("multikey"),
      },
    ],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: appConfig.baseUrl,
      },
    ],
  } satisfies DidDocument;
});
