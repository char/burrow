import { encodeUtf8 } from "@atcute/uint8array";
import * as dotenv from "@std/dotenv";
import { nanoid } from "npm:nanoid";

await dotenv.load({ envPath: ".env.local", export: true });
await dotenv.load({ envPath: ".env", export: true });

function load(v: string, def?: string): string {
  const value = Deno.env.get(v) ?? def;
  if (value === undefined)
    throw new Error(`required environment variable '${v}' was not defined!`);
  return value;
}

async function loadOrGenerate(v: string, gen: () => string | Promise<string>): Promise<string> {
  const value = Deno.env.get(v);
  if (value === undefined) {
    const newValue = await gen();
    let envLocal;
    try {
      envLocal = await Deno.readTextFile("./.env.local");
    } catch {
      envLocal = "";
    }
    if (envLocal && !/\n$/.exec(envLocal)) envLocal += "\n";
    envLocal += v + "=" + newValue.$json + "\n";
    await Deno.writeTextFile("./.env.local", envLocal);
    return newValue;
  }
  return value;
}

const env = {
  baseUrl: load("BURROW_BASE_URL"),
  dataDir: load("BURROW_DATA_DIR", "./data"),
  port: Number(load("PORT", "3000")),
  bindHost: load("BIND_HOST", "127.0.0.1"),
  fallbackAppviewUrl: load("BURROW_FALLBACK_APPVIEW_URL", "https://api.pop1.bsky.app"),
  adminPassword: Deno.env.get("BURROW_ADMIN_PASSWORD"),
  cookieSecret: await loadOrGenerate("BURROW_COOKIE_SECRET", () => nanoid(24)),
  jwtSecret: await loadOrGenerate("BURROW_JWT_SECRET", () => nanoid(24)).then(encodeUtf8),
};

export const appConfig = {
  ...env,
  did: `did:web:${encodeURIComponent(new URL(env.baseUrl).host)}` as const,
};
