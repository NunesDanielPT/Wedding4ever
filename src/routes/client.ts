import {
  applyEventStatus,
  EVENT_STATUSES,
  getEventById,
  getEventStats,
  listEventsForClient,
  listGuests,
  type EventRecord,
  type EventStatus,
} from "../db/events";
import { isAuthenticated } from "../lib/auth";
import { cardsPdfResponse, qrPngResponse, qrSvgResponse } from "../lib/event-assets";
import { clientCookie, currentClientEmail, isClientLocked, loginClient, logoutClient } from "../lib/event-auth";
import { getWinners, listAdminMissions, listAlbum, MISSION_PHASES, setMissionPhase, type MissionPhase } from "../lib/missions";
import { originalPath, previewPath, schedulePreview, thumbPath } from "../lib/photos";
import { zipStream } from "../lib/zip";
import { clientContext, clientEventPage, clientEventsPage, clientGalleryPage, clientLoginPage } from "../views/client";
import { designPage } from "../views/admin";
import { eventDesign } from "../db/events";
import { winnersPage } from "../views/winners";
import { handleDesign } from "./design";
import { field, htmlResponse, notFound, redirect } from "./http";

const CLIENT_STATUSES = EVENT_STATUSES.filter((status) => status !== "arquivado");

function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/^\.+/, "").trim().slice(0, 60) || "sem nome";
}

async function albumZip(event: EventRecord): Promise<Response> {
  const album = await listAlbum(event.db_name);
  const entries = album.map((photo, index) => ({
    name: `${String(photo.mission_position + 1).padStart(2, "0")} ${safeName(photo.mission_title)}/${String(index + 1).padStart(4, "0")} ${safeName(photo.guest_name)}.${photo.extension}`,
    path: originalPath(event.id, photo.id, photo.extension),
  }));
  return new Response(zipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="album-${event.slug}.zip"`,
    },
  });
}

async function eventPage(event: EventRecord, status = 200, error?: string): Promise<Response> {
  const [stats, guests, missions] = await Promise.all([
    getEventStats(event.db_name),
    listGuests(event.db_name),
    listAdminMissions(event.db_name),
  ]);
  return htmlResponse(clientEventPage(event, stats, guests, missions, error), status);
}

async function handleEventArea(req: Request, event: EventRecord, action: string): Promise<Response> {
  const base = `/cliente/eventos/${event.id}`;
  if (req.method === "GET") {
    if (!action) return eventPage(event);
    if (action === "qr.svg") return qrSvgResponse(event);
    if (action === "qr.png") return qrPngResponse(event);
    if (action === "cartoes.pdf") return cardsPdfResponse(event);
    if (action === "fotos.zip") return albumZip(event);
    if (action === "personalizar") return htmlResponse(designPage(event, eventDesign(event), undefined, clientContext(event)));
    if (action === "vencedores") return htmlResponse(winnersPage(event, await getWinners(event.db_name), `${base}/fotos`, base));
    if (action === "galeria") {
      const album = await listAlbum(event.db_name);
      for (const photo of album) {
        if (photo.preview_status === "pending") schedulePreview(event, photo.id, photo.extension);
      }
      return htmlResponse(clientGalleryPage(event, album));
    }
    const photo = action.match(/^fotos\/([0-9a-f-]{36})\/(thumb|preview)$/);
    if (photo) {
      const belongs = (await listAlbum(event.db_name)).some((item) => item.id === photo[1] && item.preview_status === "ready");
      if (!belongs) return notFound();
      const thumb = Bun.file(thumbPath(event.id, photo[1]!));
      const useThumb = photo[2] === "thumb" && (await thumb.exists());
      return new Response(useThumb ? thumb : Bun.file(previewPath(event.id, photo[1]!)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
      });
    }
    return notFound();
  }

  if (req.method !== "POST") return notFound();
  if (action === "personalizar") return handleDesign(req, event, clientContext(event));
  if (action === "estado") {
    const status = field(await req.formData(), "status") as EventStatus;
    if (event.status === "arquivado" || !CLIENT_STATUSES.includes(status)) {
      return eventPage(event, 422, "Não é possível aplicar esse estado.");
    }
    await applyEventStatus(event, status);
    return redirect(base);
  }
  const phaseRoute = action.match(/^missoes\/([0-9a-f-]{36})\/fase$/);
  if (phaseRoute) {
    const phase = field(await req.formData(), "phase") as MissionPhase;
    const missions = await listAdminMissions(event.db_name);
    if (!MISSION_PHASES.includes(phase) || !missions.some((mission) => mission.id === phaseRoute[1])) {
      return eventPage(event, 422, "Escolhe uma fase válida.");
    }
    await setMissionPhase(event.db_name, phaseRoute[1]!, phase);
    return redirect(`${base}#missoes`);
  }
  return notFound();
}

export async function handleClient(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/entrar") {
    if (req.method === "GET") {
      if (await currentClientEmail(req)) return redirect("/cliente");
      return htmlResponse(clientLoginPage());
    }
    if (req.method !== "POST") return notFound();
    const form = await req.formData();
    const email = field(form, "email");
    if (isClientLocked(email)) {
      return htmlResponse(clientLoginPage("Demasiadas tentativas. Tenta novamente daqui a 15 minutos."), 429);
    }
    const token = await loginClient(email, field(form, "code"));
    if (!token) return htmlResponse(clientLoginPage("O e-mail ou o código estão incorretos."), 401);
    return redirect("/cliente", { "Set-Cookie": clientCookie(token) });
  }

  if (path !== "/cliente" && !path.startsWith("/cliente/")) return undefined;

  if (path === "/cliente/sair" && req.method === "POST") {
    await logoutClient(req);
    return redirect("/entrar", { "Set-Cookie": clientCookie(null) });
  }

  const email = await currentClientEmail(req);
  if (path === "/cliente") {
    if (!email) return redirect("/entrar");
    return htmlResponse(clientEventsPage(await listEventsForClient(email)));
  }

  const match = path.match(/^\/cliente\/eventos\/([0-9a-f-]{36})(?:\/(.+))?$/);
  if (!match) return notFound();
  const event = await getEventById(match[1]!);
  const allowed = Boolean(event) && (event!.couple_email === email || (await isAuthenticated(req)));
  if (!allowed) return req.method === "GET" ? redirect("/entrar") : new Response(null, { status: 401 });
  return handleEventArea(req, event!, match[2] ?? "");
}
