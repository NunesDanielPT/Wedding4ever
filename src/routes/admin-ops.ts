import { MIN_ADMIN_PASSWORD } from "../lib/auth";
import { addOrganizer, listOrganizers, removeOrganizer, setOrganizerActive, setOrganizerPassword } from "../lib/organizers";
import { getStats } from "../lib/stats";
import { organizersPage, statsPage } from "../views/admin-ops";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

async function render(error?: string, status = 200): Promise<Response> {
  return htmlResponse(organizersPage(await listOrganizers(), error), status);
}

async function handleOrganizers(req: Request, path: string): Promise<Response> {
  if (path === "/admin/organizadores") {
    if (req.method === "GET") return render();
    if (req.method !== "POST") return notFound();
    const form = await req.formData();
    const name = field(form, "name");
    const email = field(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    if (name.length < 2 || name.length > 100) return render("Indica o nome do organizador.", 422);
    if (!isEmail(email)) return render("Indica um e-mail válido.", 422);
    if (password.length < MIN_ADMIN_PASSWORD) return render("A palavra-passe tem de ter pelo menos 12 caracteres.", 422);
    if (!(await addOrganizer(name, email, password))) return render("Esse e-mail já está registado.", 422);
    return redirect("/admin/organizadores");
  }
  const match = path.match(/^\/admin\/organizadores\/([0-9a-f-]{36})\/(palavra-passe|ativar|desativar|apagar)$/);
  if (!match || req.method !== "POST") return notFound();
  const [, id, operation] = match as unknown as [string, string, string];
  if (operation === "palavra-passe") {
    const password = String((await req.formData()).get("password") ?? "");
    if (password.length < MIN_ADMIN_PASSWORD) return render("A palavra-passe tem de ter pelo menos 12 caracteres.", 422);
    await setOrganizerPassword(id, password);
  } else if (operation === "apagar") await removeOrganizer(id);
  else await setOrganizerActive(id, operation === "ativar");
  return redirect("/admin/organizadores");
}

async function handleStats(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(params.get("ano")) || now.getFullYear();
  const month = Number(params.get("mes")) || undefined;
  const uuid = (value: string | null) => (value && /^[0-9a-f-]{36}$/.test(value) ? value : undefined);
  const stats = await getStats({
    year: year >= 2000 && year <= 2100 ? year : now.getFullYear(),
    month: month && month >= 1 && month <= 12 ? month : undefined,
    eventId: uuid(params.get("evento")),
    organizerId: uuid(params.get("organizador")),
  });
  return htmlResponse(statsPage(stats));
}

export function handleAdminOps(req: Request, path: string): Promise<Response> {
  return path === "/admin/estatisticas" ? handleStats(req) : handleOrganizers(req, path);
}
