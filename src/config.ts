function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta a variável de ambiente ${name}`);
  return value;
}

const publicUrl = new URL(required("PUBLIC_URL"));
const appSecret = required("APP_SECRET");
if (appSecret.length < 32) throw new Error("APP_SECRET tem de ter pelo menos 32 caracteres");

const database = new URL(required("DATABASE_URL"));

export const config = {
  publicUrl: publicUrl.origin,
  secureCookies: publicUrl.protocol === "https:",
  appSecret,
  port: Number(process.env.PORT ?? 3000),
  storageDir: process.env.STORAGE_DIR?.trim() || "./data",
  adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  database: {
    hostname: database.hostname,
    port: Number(database.port || 5432),
    username: decodeURIComponent(database.username),
    password: decodeURIComponent(database.password),
    database: database.pathname.slice(1),
  },
} as const;
