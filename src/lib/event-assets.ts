import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { eventDesign, type EventRecord } from "../db/events";
import type { ImageExtension } from "./design";
import { isHexColor } from "./design";
import { formatDate } from "./format";
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

/** As cores da pré-visualização vêm no link; as guardadas são usadas no resto dos casos. */
export function qrSvgResponse(event: EventRecord, url?: URL): Response {
  const design = eventDesign(event);
  const foreground = url?.searchParams.get("cor") ?? null;
  const background = url?.searchParams.get("fundo") ?? null;
  const svg = qrSvg(createQr(eventUrl(event)), {
    foreground: isHexColor(foreground) ? foreground : design.qrColor,
    background: isHexColor(background) ? background : design.qrBackground,
  });
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
    title: event.name,
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

const IMAGE_CODERS: Record<string, string> = { jpg: "jpeg", png: "png", heic: "heic", webp: "webp" };

export function designImageFormat(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 12));
  if (header.startsWith("RIFF") && header.endsWith("WEBP")) return "webp";
  if (header.slice(4, 8) === "ftyp" && ["heic", "heix", "heim", "heis", "mif1"].includes(header.slice(8))) return "heic";
  return undefined;
}

/** Converte a imagem do cartão para um formato que o PDF aceita, sem exigir nada ao utilizador. */
export async function normalizeDesignImage(bytes: Uint8Array, kind: MediaKind): Promise<{ bytes: Uint8Array; extension: ImageExtension } | undefined> {
  const format = designImageFormat(bytes);
  if (!format) return undefined;
  const extension: ImageExtension = kind === "background" ? "jpg" : "png";
  const process = Bun.spawn(
    [
      "convert", "-limit", "memory", "256MiB", "-limit", "map", "512MiB",
      `${IMAGE_CODERS[format]}:-[0]`, "-auto-orient", "-colorspace", "sRGB", "-resize", "2400x2400>", "-strip",
      ...(kind === "background" ? ["-quality", "85", "jpeg:-"] : ["-depth", "8", "-interlace", "none", "png32:-"]),
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "ignore", timeout: 120_000 },
  );
  process.stdin.write(bytes);
  await process.stdin.end();
  const output = new Uint8Array(await new Response(process.stdout).arrayBuffer());
  if ((await process.exited) !== 0 || output.length === 0) return undefined;
  return { bytes: output, extension };
}
