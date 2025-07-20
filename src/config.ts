import * as dotenv from "@std/dotenv";

await dotenv.load({ envPath: ".env.local", export: true });
await dotenv.load({ envPath: ".env", export: true });

function load(v: string, def?: string): string {
  const value = Deno.env.get(v) ?? def;
  if (value === undefined)
    throw new Error(`required environment variable '${v}' was not defined!`);
  return value;
}

export const appConfig = {
  baseUrl: load("BURROW_BASE_URL"),
  dataDir: load("BURROW_DATA_DIR", "./data"),
  port: Number(load("PORT", "3000")),
  bindHost: load("BIND_HOST", "127.0.0.1"),
  fallbackAppviewUrl: load("BURROW_FALLBACK_APPVIEW_URL", "https://api.pop1.bsky.app"),
  adminPassword: Deno.env.get("BURROW_ADMIN_PASSWORD"),
};
