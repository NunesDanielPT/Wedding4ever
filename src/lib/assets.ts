import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const versions = new Map<string, string>();

/** Junta ao link uma marca do conteúdo, para o browser e o Cloudflare recusarem cópias antigas. */
export function asset(file: string): string {
  let version = versions.get(file);
  if (!version) {
    version = createHash("sha256").update(readFileSync(join(PUBLIC_DIR, file))).digest("hex").slice(0, 10);
    versions.set(file, version);
  }
  return `/static/${file}?v=${version}`;
}
