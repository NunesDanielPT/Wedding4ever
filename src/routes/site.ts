import { addSupportMessage, getSite, siteMediaPath } from "../lib/site";
import { sitePage } from "../views/site";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

const MAX_MESSAGES = 5;
const WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function isLimited(key: string): boolean {
  const now = Date.now();
  if (attempts.size > 10_000) attempts.clear();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_MESSAGES;
}

async function handleSupport(req: Request): Promise<Response> {
  const form = await req.formData();
  const values = { name: field(form, "name"), email: field(form, "email").toLowerCase(), message: field(form, "message") };
  if (field(form, "website")) return redirect("/?enviado=1#suporte");
  let error: string | undefined;
  if (values.name.length < 2 || values.name.length > 100) error = "Indica o teu nome.";
  else if (!isEmail(values.email)) error = "Indica um e-mail válido.";
  else if (values.message.length < 5 || values.message.length > 3000) error = "Escreve uma mensagem com até 3000 caracteres.";
  else if (isLimited(clientKey(req))) error = "Já recebemos várias mensagens tuas. Tenta novamente mais tarde.";
  if (error) return htmlResponse(sitePage(await getSite(), { error, values }), 422);
  await addSupportMessage(values.name, values.email, values.message);
  return redirect("/?enviado=1#suporte");
}

export async function handleSite(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/" && req.method === "GET") {
    const url = new URL(req.url);
    const pack = url.searchParams.get("pack")?.slice(0, 80);
    return htmlResponse(sitePage(await getSite(), {
      sent: url.searchParams.has("enviado"),
      values: pack ? { message: `Tenho interesse no pack ${pack}.` } : undefined,
    }));
  }
  if (path === "/suporte" && req.method === "POST") return handleSupport(req);
  const media = path.match(/^\/media\/site\/([0-9a-f-]{36}\.(jpg|png))$/);
  if (media && req.method === "GET") {
    const file = Bun.file(siteMediaPath(media[1]!));
    if (!(await file.exists())) return notFound();
    return new Response(file, {
      headers: { "Content-Type": media[2] === "png" ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  }
  return undefined;
}
