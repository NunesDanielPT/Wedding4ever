import { eventDesign, getEventBySlug, listMissions, type EventRecord } from "../db/events";
import { themeCss } from "../lib/design";
import { mediaPath } from "../lib/event-assets";
import { currentGuest, guestCookie, GuestLimitError, joinGuest, type Guest } from "../lib/event-auth";
import { guestAlbumZip } from "../lib/album";
import { asset } from "../lib/assets";
import { brand } from "../lib/brand";
import { getWinners, listAdminMissions } from "../lib/missions";
import { removeSubscription, saveSubscription } from "../lib/notifications";
import { getVapidKeys, isAllowedEndpoint } from "../lib/push";
import { retentionOf } from "../lib/retention";
import { getSettings } from "../lib/settings";
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
import { albumPage, eventExpiredPage, guestHomePage, joinPage, missionPage } from "../views/public";
import { winnersPage } from "../views/winners";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

async function guestHome(req: Request, event: EventRecord): Promise<Response> {
  const guest = await currentGuest(req, event);
  if (!guest) return htmlResponse(joinPage(event));
  const [missions, winners] = await Promise.all([listMissions(event.db_name, guest.id), getWinners(event.db_name)]);
  return htmlResponse(guestHomePage(event, guest, missions, winners.length > 0));
}

const LIVE_CACHE_MS = 5000;
const liveCache = new Map<string, { at: number; data: unknown }>();

/** Os dados são iguais para todos os convidados, por isso poupam-se consultas durante a festa. */
async function liveUpdates(event: EventRecord): Promise<unknown> {
  const cached = liveCache.get(event.id);
  if (cached && Date.now() - cached.at < LIVE_CACHE_MS) return cached.data;
  const [missions, winners] = await Promise.all([listAdminMissions(event.db_name), getWinners(event.db_name)]);
  const data = {
    status: event.status,
    missions: missions.map(({ id, title, phase }) => ({ id, title, phase })),
    winners: winners.map(({ id, title, photos }) => ({
      id,
      title,
      photos: photos.map((photo) => ({ id: photo.id, guest: photo.guest_name })),
    })),
  };
  if (liveCache.size > 200) liveCache.clear();
  liveCache.set(event.id, { at: Date.now(), data });
  return data;
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
  try {
    const token = await joinGuest(event, name, email);
    return redirect(`/e/${event.slug}`, { "Set-Cookie": guestCookie(event.slug, token) });
  } catch (cause) {
    if (cause instanceof GuestLimitError) {
      return htmlResponse(joinPage(event, values, "Este evento já atingiu o número máximo de convidados. Fala com a organização."), 409);
    }
    throw cause;
  }
}

export async function handleEvent(req: Request, path: string): Promise<Response | undefined> {
  const match = path.match(/^\/e\/([a-z0-9-]{3,100})(?:\/(.*))?$/);
  if (!match) return undefined;
  const event = await getEventBySlug(match[1]!);
  if (!event) return notFound();
  const action = match[2] ?? "";

  const isAsset = action === "tema.css" || action === "manifest.webmanifest" || action.startsWith("media/");
  if (!isAsset && !action.startsWith("noivos")) {
    const { retentionDays } = await getSettings();
    if (retentionOf(event.event_date, retentionDays).expired) return htmlResponse(eventExpiredPage(event), 410);
  }

  if (!action && req.method === "GET") return guestHome(req, event);
  if (action === "entrar" && req.method === "POST") return handleJoin(req, event);

  if (action === "tema.css" && req.method === "GET") {
    return new Response(themeCss(eventDesign(event), event.slug, String(Date.parse(event.updated_at))), {
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

  const album = action.match(/^album\/([A-Za-z0-9_-]{20,64})(\/fotos\.zip)?$/);
  if (album && req.method === "GET") {
    if (!event.album_token || album[1] !== event.album_token) return notFound();
    const base = `/e/${event.slug}/album/${album[1]}`;
    if (!album[2]) return htmlResponse(albumPage(event, `${base}/fotos.zip`));
    const zip = await guestAlbumZip(event);
    if (zip) return zip;
    return htmlResponse(albumPage(event, `${base}/fotos.zip`, "Há muitos downloads ao mesmo tempo. Tenta outra vez daqui a alguns minutos."), 429);
  }

  if (action === "manifest.webmanifest" && req.method === "GET") {
    return new Response(
      JSON.stringify({
        name: `${brand()}: ${event.name}`,
        short_name: brand(),
        start_url: `/e/${event.slug}`,
        scope: `/e/${event.slug}`,
        display: "standalone",
        background_color: "#1f3350",
        theme_color: "#1f3350",
        lang: "pt-PT",
        icons: [
          { src: asset("icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: asset("icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      }),
      { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } },
    );
  }

  if (action === "notificacoes" || action === "notificacoes/chave") {
    const guest = await currentGuest(req, event);
    if (!guest) return new Response(null, { status: 401 });
    if (action === "notificacoes/chave" && req.method === "GET") {
      return Response.json({ publicKey: (await getVapidKeys()).publicKey });
    }
    const data = (await req.json().catch(() => null)) as { endpoint?: unknown; p256dh?: unknown; auth?: unknown } | null;
    const endpoint = data?.endpoint;
    if (typeof endpoint !== "string" || endpoint.length > 1000 || !isAllowedEndpoint(endpoint)) return new Response(null, { status: 422 });
    if (req.method === "DELETE") {
      await removeSubscription(event, endpoint);
      return new Response(null, { status: 204 });
    }
    if (req.method !== "POST" || typeof data?.p256dh !== "string" || typeof data.auth !== "string") return new Response(null, { status: 422 });
    if (data.p256dh.length > 200 || data.auth.length > 100) return new Response(null, { status: 422 });
    await saveSubscription(event, guest.id, { endpoint, p256dh: data.p256dh, auth: data.auth });
    return new Response(null, { status: 204 });
  }

  if (action === "novidades" && req.method === "GET") {
    const guest = await currentGuest(req, event);
    if (!guest) return new Response(null, { status: 401 });
    return Response.json(await liveUpdates(event), { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "vencedores" && req.method === "GET") {
    const guest = await currentGuest(req, event);
    if (!guest || !isPlaying(event)) return redirect(`/e/${event.slug}`);
    return htmlResponse(winnersPage(event, await getWinners(event.db_name), `/e/${event.slug}/fotos`, `/e/${event.slug}`));
  }

  if (action === "noivos" || action.startsWith("noivos/")) return redirect("/entrar");
  return notFound();
}
