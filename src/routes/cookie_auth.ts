import { Application, Request, Router } from "@oak/oak";
import { j, ventoEnv } from "../_deps.ts";
import { mainDb } from "../db/main_db.ts";
import { Did } from "../util/did.ts";
import { resolveHandle } from "../util/handle-resolution.ts";

export const cookieAuthInfo = new WeakMap<Request, Did>();

export function setupCookieAuthRoutes(app: Application, router: Router) {
  app.use(async (ctx, next) => {
    const burrowAuth = await ctx.cookies.get("burrow-auth", { signed: true });
    if (burrowAuth) cookieAuthInfo.set(ctx.request, burrowAuth as Did);
    return await next();
  });

  router.get("/auth/sign-in", async ctx => {
    const { content } = await ventoEnv.run("./src/templates/sign_in.vto", {
      redirect: ctx.request.url.searchParams.get("redir") ?? undefined,
    });
    ctx.response.type = "text/html";
    ctx.response.body = content;
  });

  const signInFormSchema = j.obj({
    redirect: j.optional(j.string),
    identifier: j.string,
    password: j.string,
  });
  const parseSignInFormSchema = j.compile(signInFormSchema);

  router.post("/auth/sign-in", async ctx => {
    const body = await ctx.request.body.form();
    const { value: signInForm, errors: signInFormErrors } = parseSignInFormSchema({
      identifier: body.get("identifier") ?? undefined,
      password: body.get("password") ?? undefined,
      redirect: body.get("redirect") ?? undefined,
    });
    // TODO: probably re-render the form with flashes if theres an error
    if (signInFormErrors) {
      ctx.response.status = 400;
      ctx.response.body = signInFormErrors.$json;
      ctx.response.type = "application/json";
      return;
    }

    const did = signInForm.identifier.startsWith("did:")
      ? (signInForm.identifier as Did)
      : (mainDb.lookupLocalDid(signInForm.identifier) ??
        (await resolveHandle(signInForm.identifier)));

    const account = did?.$pipe(mainDb.getAccount);
    if (!account) {
      // TODO: show error as html
      ctx.response.status = 403;
      ctx.response.body = "Account with given identifier does not exist on this PDS.";
      ctx.response.type = "text/plain";
      return;
    }

    const passwordMatches = await mainDb.verifyHash(
      account.did,
      signInForm.password,
      account.password_hash,
    );

    if (!passwordMatches) {
      // TODO: show error as html
      ctx.response.status = 403;
      ctx.response.body = "Password incorrect.";
      ctx.response.type = "text/plain";
      return;
    }

    await ctx.cookies.set("burrow-auth", account.did, {
      sameSite: "lax",
      // secure: true,
      signed: true,
    });
    ctx.response.redirect(signInForm.redirect ?? "/");
  });
}
