import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { central } from "./db/central";
import { migrateAllEvents } from "./db/events";
import { migrate } from "./db/migrate";
import { ensureFirstAdmin } from "./lib/auth";
import { handle } from "./server";

await mkdir(join(config.storageDir, "events"), { recursive: true });
await migrate(central, "central");
await ensureFirstAdmin();
await migrateAllEvents();

const server = Bun.serve({ port: config.port, fetch: handle, idleTimeout: 120, maxRequestBodySize: 30 * 1024 * 1024 });
console.log(`Wedding4Ever a correr na porta ${server.port}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await server.stop();
    await central.close();
    process.exit(0);
  });
}
