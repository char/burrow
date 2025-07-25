import { Application } from "@oak/oak";
import { j } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { DidSchema } from "../util/did.ts";
import { urlSchema } from "../util/schemas.ts";
import { XRPCRouter } from "../xrpc-server.ts";

export function setupServerRoutes(_app: Application, xrpc: XRPCRouter) {
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
      did: `did:web:${encodeURIComponent(new URL(appConfig.baseUrl).host)}` as const,
      inviteCodeRequired: true,
      phoneVerificationRequired: false,
      availableUserDomains: [],
    }),
  );
}
