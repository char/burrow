import { j } from "../../_deps.ts";
import { appConfig } from "../../config.ts";
import { DidSchema } from "../../util/did.ts";
import { urlSchema } from "../../util/schemas.ts";
import { xrpc } from "../../web.ts";

xrpc.query(
  {
    method: "com.atproto.server.describeServer",
    output: {
      inviteCodeRequired: j.optional(j.boolean),
      phoneVerificationRequired: j.optional(j.boolean),
      availableUserDomains: j.array(j.string),
      links: j.optional(
        j.obj({
          privacyPolicy: j.optional(urlSchema),
          termsOfService: j.optional(urlSchema),
        }),
      ),
      contact: j.optional(j.obj({ email: j.optional(j.string) })),
      did: DidSchema,
    },
  },
  () => ({
    did: appConfig.did,
    inviteCodeRequired: true,
    phoneVerificationRequired: false,
    availableUserDomains: [],
  }),
);
