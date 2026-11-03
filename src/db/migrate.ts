import { Glob, type SQL } from "bun";
import { join } from "node:path";

const MIGRATION_LOCK = 727401;

interface Migration {
  version: number;
  path: string;
}

async function listMigrations(scope: "central" | "event"): Promise<Migration[]> {
  const dir = join(import.meta.dir, "migrations", scope);
  const migrations: Migration[] = [];
  for await (const file of new Glob("*.sql").scan(dir)) {
    const version = Number.parseInt(file, 10);
    if (!Number.isInteger(version)) throw new Error(`Migração sem número: ${file}`);
    migrations.push({ version, path: join(dir, file) });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

/** Aplica as migrações em falta numa transação e devolve a versão final. */
export async function migrate(sql: SQL, scope: "central" | "event"): Promise<number> {
  const migrations = await listMigrations(scope);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const rows: { version: number }[] = await tx`SELECT version FROM schema_migrations`;
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await tx.unsafe(await Bun.file(migration.path).text());
      await tx`INSERT INTO schema_migrations (version) VALUES (${migration.version})`;
      applied.add(migration.version);
    }
    return Math.max(0, ...applied);
  });
}
