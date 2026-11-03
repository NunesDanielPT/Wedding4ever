import { imageExtensionOf, MAX_IMAGE_BYTES } from "../lib/image";
import {
  deleteMessage,
  getSite,
  listSupportMessages,
  removeSiteImage,
  saveSite,
  saveSiteImage,
  setMessageRead,
  SITE_COLLECTIONS,
  TEXT_FIELDS,
  type Site,
  type SiteField,
  type SiteItem,
} from "../lib/site";
import { messagesPage, siteAdminPage } from "../views/site-admin";
import { field, htmlResponse, notFound, redirect } from "./http";

const COLLECTIONS = Object.keys(SITE_COLLECTIONS) as (keyof Omit<Site, "texts"> & string)[];

async function readImage(form: FormData, name: string): Promise<string | undefined> {
  const value = form.get(name);
  if (!(value instanceof Blob) || value.size === 0) return undefined;
  if (value.size > MAX_IMAGE_BYTES) throw new Error("Cada imagem pode ter até 8 MB.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  const extension = imageExtensionOf(bytes);
  if (!extension) throw new Error("Usa uma imagem JPG ou PNG.");
  return saveSiteImage(bytes, extension);
}

/** Lê os campos do formulário, mantendo as imagens existentes que não foram trocadas. */
async function readFields(form: FormData, fields: SiteField[], current: Record<string, string>): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const item of fields) {
    if (item.type === "image") {
      const uploaded = await readImage(form, item.name);
      const removed = form.get(`remove_${item.name}`) !== null;
      if (uploaded || removed) await removeSiteImage(current[item.name]);
      values[item.name] = uploaded ?? (removed ? "" : current[item.name] ?? "");
      if (item.required && !values[item.name]) throw new Error(`Falta preencher: ${item.label}.`);
      continue;
    }
    if (item.type === "checkbox") {
      values[item.name] = form.get(item.name) !== null ? "1" : "";
      continue;
    }
    const value = field(form, item.name);
    if (value.length > 5000) throw new Error(`O campo ${item.label} é demasiado longo.`);
    if (item.required && !value) throw new Error(`Falta preencher: ${item.label}.`);
    if (item.type === "url" && value && !/^https?:\/\/[^\s]+$/i.test(value)) throw new Error("O link tem de começar por https://.");
    values[item.name] = value;
  }
  return values;
}

async function handleCollection(req: Request, site: Site, name: string, rest: string[]): Promise<Response> {
  if (!COLLECTIONS.includes(name as (typeof COLLECTIONS)[number]) || req.method !== "POST") return notFound();
  const key = name as (typeof COLLECTIONS)[number];
  const items = site[key];
  const fields = SITE_COLLECTIONS[key]!.fields;
  const back = redirect(`/admin/site#${key}`);

  if (rest.length === 0) {
    const values = await readFields(await req.formData(), fields, {});
    items.push({ id: crypto.randomUUID(), ...values } as SiteItem);
    await saveSite(site);
    return back;
  }

  const [id, operation] = rest;
  const index = items.findIndex((item) => item.id === id);
  const item = items[index];
  if (!item) return notFound();
  if (operation === "guardar") {
    items[index] = { ...item, ...(await readFields(await req.formData(), fields, item)) };
  } else if (operation === "subir" || operation === "descer") {
    const target = index + (operation === "subir" ? -1 : 1);
    if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target]!, item];
  } else if (operation === "apagar") {
    items.splice(index, 1);
    await removeSiteImage(item.image);
  } else return notFound();
  await saveSite(site);
  return back;
}

async function handleMessages(req: Request, path: string): Promise<Response> {
  if (path === "/admin/mensagens" && req.method === "GET") return htmlResponse(messagesPage(await listSupportMessages()));
  const match = path.match(/^\/admin\/mensagens\/([0-9a-f-]{36})\/(lida|por-ler|apagar)$/);
  if (!match || req.method !== "POST") return notFound();
  if (match[2] === "apagar") await deleteMessage(match[1]!);
  else await setMessageRead(match[1]!, match[2] === "lida");
  return redirect("/admin/mensagens");
}

export async function handleSiteAdmin(req: Request, path: string): Promise<Response> {
  if (path.startsWith("/admin/mensagens")) return handleMessages(req, path);
  const site = await getSite();
  if (path === "/admin/site" && req.method === "GET") return htmlResponse(siteAdminPage(site));
  try {
    if (path === "/admin/site/textos" && req.method === "POST") {
      site.texts = { ...site.texts, ...(await readFields(await req.formData(), TEXT_FIELDS, site.texts)) };
      await saveSite(site);
      return redirect("/admin/site");
    }
    const [collection, ...rest] = path.replace("/admin/site/", "").split("/");
    return await handleCollection(req, site, collection!, rest);
  } catch (cause) {
    if (cause instanceof Error && !("code" in cause)) return htmlResponse(siteAdminPage(site, cause.message), 422);
    throw cause;
  }
}
