import {
  applyEventStatus,
  createEvent,
  EVENT_STATUSES,
  eventDesign,
  getEventById,
  getEventStats,
  listEventsForClient,
  listGuests,
  type EventRecord,
  type EventStatus,
} from "../db/events";
import { isAuthenticated } from "../lib/auth";
import { cardsPdfResponse, qrPngResponse, qrSvgResponse } from "../lib/event-assets";
import { MIN_ADMIN_PASSWORD } from "../lib/auth";
import { config } from "../config";
import { brand } from "../lib/brand";
import { getTemplates, renderTemplate } from "../lib/email-templates";
import { sendMail } from "../lib/mail";
import {
  applyPasswordReset,
  clientCookie,
  createPasswordReset,
  currentClientEmail,
  generateClientCode,
  isClientLocked,
  isResetValid,
  loginClient,
  logoutClient,
} from "../lib/event-auth";
import { findActiveOrganizer, refundOrganizerCredit, useOrganizerCredit } from "../lib/organizers";
import { getSettings } from "../lib/settings";
import { getSite } from "../lib/site";
import { deletePhotoAsManager, getAlbumPage, getWinners, isAlbumPhoto, setPhotoHidden, listAdminMissions, listAlbumMissions, MISSION_PHASES, setMissionPhase, type MissionPhase } from "../lib/missions";
import { previewPath, schedulePreview, thumbPath } from "../lib/photos";
import { albumZip } from "../lib/album";
import { clientContext, clientEventPage, clientEventsPage, clientExpiredPage, clientGalleryIndex, clientGalleryPage, clientLoginPage, clientShell, notesPage, recoverPage, resetPage } from "../views/client";
import { designPage, newEventPage } from "../views/admin";
import { getEventNotes, PAYMENT_LABELS, saveEventNotes, type PaymentStatus } from "../lib/event-notes";
import { queueEventEmails } from "../lib/event-emails";
import { queueNotifications } from "../lib/notifications";
import { retentionForEvent } from "../lib/retention";
import { runAsAdmin } from "../lib/viewer";
import { winnersPage } from "../views/winners";
import { handleDesign } from "./design";
import { readEventForm } from "./event-form";
import { handleMissions } from "./missions";
import { field, htmlResponse, isEmail, notFound, redirect } from "./http";

const GALLERY_PAGE_SIZE = 60;
const CLIENT_STATUSES = EVENT_STATUSES.filter((status) => status !== "arquivado");

async function eventPage(event: EventRecord, canManage: boolean, status = 200, error?: string, code?: string): Promise<Response> {
  const [stats, guests, missions] = await Promise.all([
    getEventStats(event.db_name),
    listGuests(event.db_name),
    listAdminMissions(event.db_name),
  ]);
  return htmlResponse(clientEventPage(event, stats, guests, missions, error, canManage ? { code } : undefined, (await getSettings()).retentionDays), status);
}

async function handleEventArea(req: Request, event: EventRecord, action: string, canManage: boolean): Promise<Response> {
  const base = `/cliente/eventos/${event.id}`;
  if (canManage && (action === "missoes" || action.startsWith("missoes/")) && !action.endsWith("/fase")) {
    return handleMissions(req, event, action, { base, back: base, wrap: clientShell });
  }
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (!action) return eventPage(event, canManage);
    if (action === "qr.svg") return qrSvgResponse(event, url);
    if (action === "qr.png") return qrPngResponse(event);
    if (action === "cartoes.pdf") return cardsPdfResponse(event);
    if (action === "fotos.zip") return albumZip(event);
    if (action === "notas") {
      if (!canManage) return notFound();
      return htmlResponse(notesPage(event, await getEventNotes(event.id), undefined, url.searchParams.has("guardado")));
    }
    if (action === "personalizar") return htmlResponse(designPage(event, eventDesign(event), undefined, clientContext(event), url.searchParams.has("guardado")));
    if (action === "vencedores") return htmlResponse(winnersPage(event, await getWinners(event.db_name), `${base}/fotos`, base));
    if (action === "galeria") {
      const missionId = url.searchParams.get("missao");
      if (!missionId) return htmlResponse(clientGalleryIndex(event, await listAlbumMissions(event.db_name)));
      if (!/^[0-9a-f-]{36}$/.test(missionId)) return notFound();
      const page = Math.max(1, Math.min(Number(url.searchParams.get("pagina")) || 1, 100_000));
      const search = (url.searchParams.get("nome") ?? "").trim().slice(0, 80);
      const album = await getAlbumPage(event.db_name, missionId, page, GALLERY_PAGE_SIZE, search, canManage);
      if (!album) return notFound();
      for (const photo of album.photos) {
        if (photo.preview_status === "pending") schedulePreview(event, photo.id, photo.extension);
      }
      return htmlResponse(clientGalleryPage(event, album, page, GALLERY_PAGE_SIZE, search, canManage));
    }
    const photo = action.match(/^fotos\/([0-9a-f-]{36})\/(thumb|preview)$/);
    if (photo) {
      if (!(await isAlbumPhoto(event.db_name, photo[1]!, canManage))) return notFound();
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
  if (action === "notas" && canManage) {
    const form = await req.formData();
    const notes = {
      contact_name: field(form, "contact_name"),
      contact_phone: field(form, "contact_phone"),
      contact_email: field(form, "contact_email"),
      payment_status: field(form, "payment_status") as PaymentStatus,
      amount: field(form, "amount"),
      notes: field(form, "notes"),
    };
    let error: string | undefined;
    if (!(notes.payment_status in PAYMENT_LABELS)) error = "Escolhe um estado de pagamento válido.";
    else if (notes.contact_email && !isEmail(notes.contact_email)) error = "Indica um e-mail de contacto válido.";
    else if (Math.max(notes.contact_name.length, notes.contact_phone.length, notes.amount.length) > 120) error = "Encurta os campos de contacto e de valor.";
    else if (notes.notes.length > 20_000) error = "As notas podem ter até 20 000 caracteres.";
    if (error) return htmlResponse(notesPage(event, notes, error), 422);
    await saveEventNotes(event.id, notes);
    return redirect(`${base}/notas?guardado=1`);
  }
  const moderation = action.match(/^fotos\/([0-9a-f-]{36})\/(esconder|mostrar|apagar)$/);
  if (moderation && canManage) {
    const [, photoId, operation] = moderation as unknown as [string, string, string];
    const missionId =
      operation === "apagar"
        ? await deletePhotoAsManager(event, photoId)
        : await setPhotoHidden(event.db_name, photoId, operation === "esconder");
    if (!missionId) return notFound();
    const params = new URL(req.url).searchParams;
    return redirect(`${base}/galeria?missao=${missionId}&pagina=${Number(params.get("pagina")) || 1}`);
  }
  if (action === "codigo" && canManage) return eventPage(event, canManage, 200, undefined, await generateClientCode(event));
  if (action === "estado") {
    const status = field(await req.formData(), "status") as EventStatus;
    if (event.status === "arquivado" || !CLIENT_STATUSES.includes(status)) {
      return eventPage(event, canManage, 422, "Não é possível aplicar esse estado.");
    }
    await applyEventStatus(event, status);
    queueNotifications(event.id);
    return redirect(base);
  }
  const phaseRoute = action.match(/^missoes\/([0-9a-f-]{36})\/fase$/);
  if (phaseRoute) {
    const phase = field(await req.formData(), "phase") as MissionPhase;
    const missions = await listAdminMissions(event.db_name);
    if (!MISSION_PHASES.includes(phase) || !missions.some((mission) => mission.id === phaseRoute[1])) {
      return eventPage(event, canManage, 422, "Escolhe uma fase válida.");
    }
    await setMissionPhase(event.db_name, phaseRoute[1]!, phase);
    queueNotifications(event.id);
    return redirect(`${base}#missoes`);
  }
  return notFound();
}

const resetAttempts = new Map<string, number[]>();

function resetLimited(email: string): boolean {
  const now = Date.now();
  if (resetAttempts.size > 10_000) resetAttempts.clear();
  const recent = (resetAttempts.get(email) ?? []).filter((at) => now - at < 3_600_000);
  recent.push(now);
  resetAttempts.set(email, recent);
  return recent.length > 3;
}

async function sendResetEmail(email: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.email.enabled || !settings.email.host) return;
  const token = await createPasswordReset(email);
  if (!token) return;
  const template = (await getTemplates()).recuperacao;
  const variables = { link: `${config.publicUrl}/recuperar/${token}`, plataforma: brand() };
  await sendMail(settings.email, {
    to: email,
    subject: renderTemplate(template.subject, variables),
    text: renderTemplate(template.body, variables),
  });
}

async function handleRecovery(req: Request, path: string): Promise<Response> {
  if (path === "/recuperar") {
    if (req.method === "GET") return htmlResponse(recoverPage());
    if (req.method !== "POST") return notFound();
    const email = field(await req.formData(), "email").toLowerCase();
    if (isEmail(email) && !resetLimited(email)) {
      void sendResetEmail(email).catch((cause) => console.error("Falha na recuperação de acesso", cause));
    }
    return htmlResponse(recoverPage("Se este e-mail tiver conta, vais receber um link em alguns minutos. Se não chegar, fala com a organização."));
  }
  const token = path.slice("/recuperar/".length);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return notFound();
  if (!(await isResetValid(token))) return htmlResponse(recoverPage(undefined, "Este link já não é válido. Pede um novo."), 410);
  if (req.method === "GET") return htmlResponse(resetPage(token));
  if (req.method !== "POST") return notFound();
  const password = String((await req.formData()).get("password") ?? "");
  if (password.length < MIN_ADMIN_PASSWORD) {
    return htmlResponse(resetPage(token, `A palavra-passe tem de ter pelo menos ${MIN_ADMIN_PASSWORD} caracteres.`), 422);
  }
  await applyPasswordReset(token, password);
  return redirect("/entrar?alterada=1");
}

export async function handleClient(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/recuperar" || path.startsWith("/recuperar/")) return handleRecovery(req, path);
  if (path === "/entrar") {
    if (req.method === "GET") {
      if (await currentClientEmail(req)) return redirect("/cliente");
      return htmlResponse(clientLoginPage(undefined, new URL(req.url).searchParams.has("alterada")));
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
  const organizer = email ? await findActiveOrganizer(email) : undefined;
  if (path === "/cliente") {
    if (!email) return redirect("/entrar");
    return htmlResponse(clientEventsPage(await listEventsForClient(email, organizer?.id), Boolean(organizer), (await getSettings()).retentionDays, organizer?.event_credits));
  }

  if (path === "/cliente/eventos/novo") {
    if (!organizer) return req.method === "GET" ? redirect("/entrar") : new Response(null, { status: 401 });
    const context = { action: "/cliente/eventos/novo", back: "/cliente", wrap: clientShell };
    const { packs } = await getSite();
    if (req.method === "GET") return htmlResponse(newEventPage(packs, {}, undefined, context));
    if (req.method !== "POST") return notFound();
    const parsed = readEventForm(await req.formData(), packs);
    const values = { ...parsed.values, packId: parsed.packId };
    if (parsed.error) return htmlResponse(newEventPage(packs, values, parsed.error, context), 422);
    if (!(await useOrganizerCredit(organizer.id))) {
      return htmlResponse(newEventPage(packs, values, "O teu pacote já não tem eventos disponíveis. Fala com a administração.", context), 409);
    }
    let event: EventRecord;
    try {
      event = await createEvent({
        ...parsed.values,
        organizerId: organizer.id,
        photoLimit: (await getSettings()).defaultPhotoLimit,
        packName: parsed.packName,
        guestLimit: parsed.guestLimit,
      });
    } catch (cause) {
      await refundOrganizerCredit(organizer.id);
      throw cause;
    }
    queueEventEmails(event);
    return redirect(`/cliente/eventos/${event.id}`);
  }

  const match = path.match(/^\/cliente\/eventos\/([0-9a-f-]{36})(?:\/(.+))?$/);
  if (!match) return notFound();
  const event = await getEventById(match[1]!);
  if (!event) return notFound();
  const isAdmin = await isAuthenticated(req);
  const owns = organizer !== undefined && event.organizer_id === organizer.id;
  if (!isAdmin && !owns && event.couple_email !== email) {
    return req.method === "GET" ? redirect("/entrar") : new Response(null, { status: 401 });
  }
  const { retentionDays } = await getSettings();
  const retention = retentionForEvent(event, retentionDays);
  if (retention.expired && !isAdmin) return htmlResponse(clientExpiredPage(event, retention.deleteDate), 410);
  return runAsAdmin(isAdmin, () => handleEventArea(req, event, match[2] ?? "", isAdmin || owns));
}
