import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { configFromEnv } from "./config";

const config = configFromEnv();
const { app } = await buildApp(config);

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[temujira] v${config.version} listening on http://${info.address}:${info.port} (data: ${config.dataDir})`);
});
