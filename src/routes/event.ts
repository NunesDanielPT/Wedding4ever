import { applyEventStatus, EVENT_STATUSES, eventDesign, getEventBySlug, getEventStats, listGuests, listMissions, type EventRecord, type EventStatus } from "../db/events";
import { themeCss } from "../lib/design";
import { cardsPdfResponse, mediaPath, qrPngResponse, qrSvgResponse } from "../lib/event-assets";
import {
  coupleCookie,
  currentGuest,
  type Guest,
  guestCookie,
  isCoupleAuthenticated,
  isCoupleLocked,
  joinGuest,
  loginCouple,
  logoutCouple,
} from "../lib/event-auth";
import { listAdminMissions, MISSION_PHASES, setMissionPhase, type MissionPhase } from "../lib/missions";
import {
  canViewPhoto,
  countGuestPhotos,
  deleteOwnPhoto,
  getGuestVote,
  getMission,
  listGalleryPhotos,
  listOwnPhotos,
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  PhotoError,
  previewPath,
  savePhoto,
  thumbPath,
  votePhoto,
  type MissionDetail,
} from "../lib/photos";
import { coupleLoginPage, couplePanelPage, guestHomePage, joinPage, missionPage } from "../views/public";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

const COUPLE_STATUSES = EVENT_STATUSES.filter((status) => status !== "arquivado");

async function couplePanel(event: EventRecord, error?: string, status = 200): Promise<Response> {
  const [stats, guests, missions] = await Promise.all([
    getEventStats(event.db_name),
    listGuests(event.db_name),
    listAdminMissions(event.db_name),
  ]).catch(() => [null, [], []] as const);
  return htmlResponse(couplePanelPage(event, stats, [...guests], [...missions], error), status);
}

async function handleCouple(req: Request, event: EventRecord, action: string): Promise<Response> {
  const base = `/e/${event.slug}/noivos`;

  if (action === "entrar" && req.method === "POST") {
    if (isCoupleLocked(event)) {
      const page = coupleLoginPage(event, "Demasiadas tentativas. Tenta novamente daqui a 15 minutos.", 429);
      return htmlResponse(page.body, page.status);
    }
    const form = await req.formData();
    const token = await loginCouple(event, field(form, "email"), field(form, "code"));
    if (!token) {
      const page = coupleLoginPage(event, "O e-mail ou o código estão incorretos.", 401);
      return htmlResponse(page.body, page.status);
    }
    return redirect(base, { "Set-Cookie": coupleCookie(event.slug, token) });
  }

  const authenticated = await isCoupleAuthenticated(req, event);
  if (!authenticated) {
    if (req.method !== "GET") return new Response(null, { status: 401 });
    if (action) return redirect(base);
    const page = coupleLoginPage(event);
    return htmlResponse(page.body, page.status);
  }

  if (!action && req.method === "GET") return couplePanel(event);
  if (action === "qr.svg" && req.method === "GET") return qrSvgResponse(event);
  if (action === "qr.png" && req.method === "GET") return qrPngResponse(event);
  if (action === "cartoes.pdf" && req.method === "GET") return cardsPdfResponse(event);

  if (action === "estado" && req.method === "POST") {
    const status = field(await req.formData(), "status") as EventStatus;
    if (event.status === "arquivado" || !COUPLE_STATUSES.includes(status)) {
      return couplePanel(event, "Não é possível aplicar esse estado.", 422);
    }
    await applyEventStatus(event, status);
    return redirect(base);
  }

  const phaseRoute = action.match(/^missoes\/([0-9a-f-]{36})\/fase$/);
  if (phaseRoute && req.method === "POST") {
    const phase = field(await req.formData(), "phase") as MissionPhase;
    const mission = await getMission(event.db_name, phaseRoute[1]!);
    if (!mission || !MISSION_PHASES.includes(phase)) return couplePanel(event, "Escolhe uma fase válida.", 422);
    await setMissionPhase(event.db_name, mission.id, phase);
    return redirect(base);
  }

  if (action === "sair" && req.method === "POST") {
    await logoutCouple(req);
    return redirect(base, { "Set-Cookie": coupleCookie(event.slug, null) });
  }
  return notFound();
}

async function guestHome(req: Request, event: EventRecord): Promise<Response> {
  const guest = await currentGuest(req, event);
  if (!guest) return htmlResponse(joinPage(event));
  return htmlResponse(guestHomePage(event, guest, await listMissions(event.db_name, guest.id)));
}

function isPlaying(event: EventRecord): boolean {
  return event.status !== "rascunho" && event.status !== "arquivado";
}

async function renderMission(event: EventRecord, guest: Guest, mission: MissionDetail, error?: string, status = 200): Promise<Response> {
  const [photos, sent, vote] = await Promise.all([
    mission.phase === "envio" ? listOwnPhotos(event, mission.id, guest.id) : listGalleryPhotos(event, mission),
    countGuestPhotos(event.db_name, guest.id, mission.id),
    getGuestVote(event.db_name, guest.id, mission.id),
  ]);
  return htmlResponse(missionPage(event, guest, mission, photos, sent, vote, error), status);
}

async function handleUpload(req: Request, event: EventRecord, guest: Guest, mission: MissionDetail): Promise<Response> {
  if (mission.phase !== "envio") return renderMission(event, guest, mission, "O envio de fotografias está fechado.", 409);
  const form = await req.formData();
  const file = form.get("photo");
  const caption = field(form, "caption");
  if (!(file instanceof Blob) || file.size === 0) return renderMission(event, guest, mission, "Escolhe uma fotografia.", 422);
  if (file.size > MAX_PHOTO_BYTES) return renderMission(event, guest, mission, "A fotografia pode ter até 25 MB.", 413);
  if (caption.length > MAX_CAPTION_LENGTH) {
    return renderMission(event, guest, mission, `A legenda pode ter até ${MAX_CAPTION_LENGTH} caracteres.`, 422);
  }
  try {
    await savePhoto(event, { guestId: guest.id, mission, caption, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (cause) {
    if (cause instanceof PhotoError) return renderMission(event, guest, mission, cause.message, 422);
    throw cause;
  }
  return redirect(`/e/${event.slug}/missoes/${mission.id}`);
}

async function handlePhotos(req: Request, event: EventRecord, action: string): Promise<Response | undefined> {
  const missionRoute = action.match(/^missoes\/([0-9a-f-]{36})(\/fotos)?$/);
  const photoRoute = action.match(/^fotos\/([0-9a-f-]{36})\/(preview|thumb|apagar|votar)$/);
  if (!missionRoute && !photoRoute) return undefined;

  const guest = await currentGuest(req, event);
  if (!guest) return req.method === "GET" ? redirect(`/e/${event.slug}`) : new Response(null, { status: 401 });
  if (!isPlaying(event)) return req.method === "GET" ? redirect(`/e/${event.slug}`) : new Response(null, { status: 409 });

  if (missionRoute) {
    const mission = await getMission(event.db_name, missionRoute[1]!);
    if (!mission) return notFound();
    if (!missionRoute[2] && req.method === "GET") return renderMission(event, guest, mission);
    if (missionRoute[2] && req.method === "POST") return handleUpload(req, event, guest, mission);
    return notFound();
  }

  const [, photoId, photoAction] = photoRoute as unknown as [string, string, string];
  if ((photoAction === "preview" || photoAction === "thumb") && req.method === "GET") {
    if (!(await canViewPhoto(event.db_name, guest.id, photoId))) return notFound();
    const thumb = Bun.file(thumbPath(event.id, photoId));
    const useThumb = photoAction === "thumb" && (await thumb.exists());
    return new Response(useThumb ? thumb : Bun.file(previewPath(event.id, photoId)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
    });
  }
  if (photoAction === "apagar" && req.method === "POST") {
    const missionId = await deleteOwnPhoto(event, guest.id, photoId);
    return missionId ? redirect(`/e/${event.slug}/missoes/${missionId}`) : notFound();
  }
  if (photoAction === "votar" && req.method === "POST") {
    try {
      const missionId = await votePhoto(event.db_name, guest.id, photoId);
      return redirect(`/e/${event.slug}/missoes/${missionId}`);
    } catch (cause) {
      if (cause instanceof PhotoError) return new Response(cause.message, { status: 422 });
      throw cause;
    }
  }
  return notFound();
}

async function handleJoin(req: Request, event: EventRecord): Promise<Response> {
  if (event.status === "arquivado") return redirect(`/e/${event.slug}`);
  const form = await req.formData();
  const name = field(form, "name");
  const email = field(form, "email").toLowerCase();
  const values = { name, email };
  if (name.length < 2 || name.length > 80) return htmlResponse(joinPage(event, values, "Indica o teu nome completo."), 422);
  if (!isEmail(email)) return htmlResponse(joinPage(event, values, "Indica um e-mail válido."), 422);
  const token = await joinGuest(event, name, email);
  return redirect(`/e/${event.slug}`, { "Set-Cookie": guestCookie(event.slug, token) });
}

export async function handleEvent(req: Request, path: string): Promise<Response | undefined> {
  const match = path.match(/^\/e\/([a-z0-9-]{3,100})(?:\/(.*))?$/);
  if (!match) return undefined;
  const event = await getEventBySlug(match[1]!);
  if (!event) return notFound();
  const action = match[2] ?? "";

  if (!action && req.method === "GET") return guestHome(req, event);
  if (action === "entrar" && req.method === "POST") return handleJoin(req, event);

  if (action === "tema.css" && req.method === "GET") {
    return new Response(themeCss(eventDesign(event), event.slug), {
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  const media = action.match(/^media\/(background|logo)$/);
  if (media && req.method === "GET") {
    const kind = media[1] as "background" | "logo";
    const design = eventDesign(event);
    const extension = kind === "background" ? design.backgroundImage : design.logoImage;
    if (!extension) return notFound();
    const file = Bun.file(mediaPath(event.id, kind, extension));
    if (!(await file.exists())) return notFound();
    return new Response(file, {
      headers: { "Content-Type": extension === "png" ? "image/png" : "image/jpeg", "Cache-Control": "no-cache" },
    });
  }

  const photoResponse = await handlePhotos(req, event, action);
  if (photoResponse) return photoResponse;

  if (action === "noivos" || action.startsWith("noivos/")) {
    return handleCouple(req, event, action.slice("noivos/".length));
  }
  return notFound();
}
