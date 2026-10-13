import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "./app.ts";
import { notConfiguredAuth, workosAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { postgresDb } from "./db.ts";
import { migrate } from "./migrate.ts";

const log = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};

const config = loadConfig(process.env);
const db = postgresDb(config.databaseUrl);
const applied = await migrate(db);
log(`database ready, ${applied} new migrations`);
const auth = config.workos === undefined ? notConfiguredAuth : workosAuth(config.workos);
if (!auth.configured) {
  log("WorkOS is not configured. Login is off.");
}
const app = createApp({
  db,
  auth,
  siteUrl: config.siteUrl,
  publicApiUrl: config.publicApiUrl,
  log,
  ip: (c) => {
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return undefined;
    }
  },
});
const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  log(`ade API listens on port ${info.port}`);
});

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  log(`${signal}: stopping`);
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
