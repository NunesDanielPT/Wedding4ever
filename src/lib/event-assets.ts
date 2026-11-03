import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { eventDesign, type EventRecord } from "../db/events";
import type { ImageExtension } from "./design";
import { coupleNames, formatDate } from "./format";
import { toPdfImage, type PdfImage } from "./image";
import { tableCardsPdf } from "./pdf";
import { qrPng } from "./png";
import { createQr, qrSvg } from "./qr";

export type MediaKind = "background" | "logo";

export function eventUrl(event: EventRecord): string {
  return `${config.publicUrl}/e/${event.slug}`;
}

function designDir(eventId: string): string {
  return join(config.storageDir, "events", eventId, "design");
}

export function mediaPath(eventId: string, kind: MediaKind, extension: ImageExtension): string {
  return join(designDir(eventId), `${kind}.${extension}`);
}

export async function saveMedia(eventId: string, kind: MediaKind, extension: ImageExtension, bytes: Uint8Array) {
  await mkdir(designDir(eventId), { recursive: true });
  await removeMedia(eventId, kind);
  await Bun.write(mediaPath(eventId, kind, extension), bytes);
}

export async function removeMedia(eventId: string, kind: MediaKind): Promise<void> {
  await rm(mediaPath(eventId, kind, "jpg"), { force: true });
  await rm(mediaPath(eventId, kind, "png"), { force: true });
}

export function qrSvgResponse(event: EventRecord): Response {
  const design = eventDesign(event);
  const svg = qrSvg(createQr(eventUrl(event)), { foreground: design.qrColor, background: design.qrBackground });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `inline; filename="qr-${event.slug}.svg"`,
      "Cache-Control": "no-cache",
    },
  });
}

export function qrPngResponse(event: EventRecord): Response {
  const design = eventDesign(event);
  return new Response(qrPng(createQr(eventUrl(event)), design.qrColor, design.qrBackground), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qr-${event.slug}.png"`,
    },
  });
}

async function loadImage(eventId: string, kind: MediaKind, extension?: ImageExtension): Promise<PdfImage | undefined> {
  if (!extension) return undefined;
  const file = Bun.file(mediaPath(eventId, kind, extension));
  if (!(await file.exists())) return undefined;
  return toPdfImage(new Uint8Array(await file.arrayBuffer()));
}

export async function cardsPdfResponse(event: EventRecord): Promise<Response> {
  const design = eventDesign(event);
  const pdf = tableCardsPdf({
    couple: coupleNames(event.partner_one, event.partner_two),
    date: formatDate(event.event_date),
    url: eventUrl(event),
    design,
    background: await loadImage(event.id, "background", design.backgroundImage),
    logo: await loadImage(event.id, "logo", design.logoImage),
  });
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cartoes-${event.slug}.pdf"`,
    },
  });
}
