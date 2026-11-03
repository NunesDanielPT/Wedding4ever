import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { eventDb, type EventRecord } from "../db/events";

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_CAPTION_LENGTH = 280;
export type PhotoExtension = "jpg" | "png" | "heic";

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1"]);
const IMAGE_CODER: Record<PhotoExtension, string> = { jpg: "jpeg", png: "png", heic: "heic" };
const MAX_CONVERSIONS = 2;
const CONVERSION_TIMEOUT_MS = 120_000;

export interface Photo {
  id: string;
  guest_id: string;
  guest_name: string;
  caption: string;
  preview_status: "pending" | "ready" | "failed";
  votes: number;
}

export interface MissionDetail {
  id: string;
  title: string;
  photo_limit: number;
  phase: "envio" | "votacao" | "encerrada";
}

export class PhotoError extends Error {}

/** Identifica o formato pelo conteúdo, porque o nome e o tipo do ficheiro podem ser falsos. */
export function detectPhoto(bytes: Uint8Array): PhotoExtension | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return "png";
  const box = new TextDecoder("latin1").decode(bytes.subarray(4, 12));
  if (box.startsWith("ftyp") && HEIC_BRANDS.has(box.slice(4))) return "heic";
  return undefined;
}

function photosDir(eventId: string): string {
  return join(config.storageDir, "events", eventId, "photos");
}

function originalPath(eventId: string, photoId: string, extension: string): string {
  return join(photosDir(eventId), `${photoId}.${extension}`);
}

export function previewPath(eventId: string, photoId: string): string {
  return join(photosDir(eventId), `${photoId}.preview.jpg`);
}

export function thumbPath(eventId: string, photoId: string): string {
  return join(photosDir(eventId), `${photoId}.thumb.jpg`);
}

export async function removePhotoFiles(eventId: string, photoId: string, extension: string): Promise<void> {
  await Promise.all([
    rm(originalPath(eventId, photoId, extension), { force: true }),
    rm(previewPath(eventId, photoId), { force: true }),
    rm(thumbPath(eventId, photoId), { force: true }),
  ]);
}

const queue: (() => Promise<void>)[] = [];
const scheduled = new Set<string>();
let running = 0;

function pump(): void {
  while (running < MAX_CONVERSIONS && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}

async function convert(args: string[]): Promise<boolean> {
  const process = Bun.spawn(["convert", "-limit", "memory", "256MiB", "-limit", "map", "512MiB", ...args], {
    stdout: "ignore",
    stderr: "ignore",
    timeout: CONVERSION_TIMEOUT_MS,
  });
  return (await process.exited) === 0;
}

/** Cria a imagem de ecrã inteiro e, a partir dela, a miniatura quadrada da galeria. */
async function createPreview(event: EventRecord, photoId: string, extension: PhotoExtension): Promise<void> {
  const source = originalPath(event.id, photoId, extension);
  const preview = previewPath(event.id, photoId);
  const thumb = thumbPath(event.id, photoId);
  const ready =
    (await convert([
      `${IMAGE_CODER[extension]}:${source}[0]`,
      "-auto-orient", "-resize", "1600x1600>", "-strip", "-quality", "82", `jpeg:${preview}`,
    ])) &&
    (await convert([
      `jpeg:${preview}`,
      "-thumbnail", "480x480^", "-gravity", "center", "-extent", "480x480", "-quality", "76", `jpeg:${thumb}`,
    ]));
  const status = ready ? "ready" : "failed";
  await eventDb(event.db_name)`UPDATE photos SET preview_status = ${status} WHERE id = ${photoId}::uuid`;
}

/** Coloca a miniatura na fila; também recupera as que ficaram por fazer após um reinício. */
export function schedulePreview(event: EventRecord, photoId: string, extension: PhotoExtension): void {
  if (scheduled.has(photoId)) return;
  scheduled.add(photoId);
  queue.push(() =>
    createPreview(event, photoId, extension)
      .catch((cause) => console.error(`Falha na miniatura ${photoId}`, cause))
      .finally(() => scheduled.delete(photoId)),
  );
  pump();
}

export async function getMission(dbName: string, id: string): Promise<MissionDetail | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const rows: MissionDetail[] = await eventDb(dbName)`
    SELECT id, title, photo_limit, phase FROM missions WHERE id = ${id}::uuid AND active
  `;
  return rows[0];
}

export async function countGuestPhotos(dbName: string, guestId: string, missionId: string): Promise<number> {
  const [row]: { count: number }[] = await eventDb(dbName)`
    SELECT count(*)::int AS count FROM photos WHERE guest_id = ${guestId}::uuid AND mission_id = ${missionId}::uuid
  `;
  return row!.count;
}

function schedulePending(event: EventRecord, photos: (Photo & { extension: PhotoExtension })[]): Photo[] {
  for (const photo of photos) {
    if (photo.preview_status === "pending") schedulePreview(event, photo.id, photo.extension);
  }
  return photos;
}

export async function listOwnPhotos(event: EventRecord, missionId: string, guestId: string): Promise<Photo[]> {
  const rows: (Photo & { extension: PhotoExtension })[] = await eventDb(event.db_name)`
    SELECT p.id, p.guest_id, g.full_name AS guest_name, p.caption, p.preview_status, p.extension, 0 AS votes
    FROM photos p JOIN guests g ON g.id = p.guest_id
    WHERE p.mission_id = ${missionId}::uuid AND p.guest_id = ${guestId}::uuid AND NOT p.hidden
    ORDER BY p.created_at DESC
  `;
  return schedulePending(event, rows);
}

/** Galeria completa da missão; nas encerradas, as mais votadas ficam primeiro. */
export async function listGalleryPhotos(event: EventRecord, mission: MissionDetail): Promise<Photo[]> {
  const rows: (Photo & { extension: PhotoExtension })[] = await eventDb(event.db_name)`
    SELECT p.id, p.guest_id, g.full_name AS guest_name, p.caption, p.preview_status, p.extension,
           (SELECT count(*)::int FROM votes v WHERE v.photo_id = p.id) AS votes
    FROM photos p JOIN guests g ON g.id = p.guest_id
    WHERE p.mission_id = ${mission.id}::uuid AND NOT p.hidden
    ORDER BY p.created_at
  `;
  const photos = schedulePending(event, rows);
  if (mission.phase !== "encerrada") return photos;
  return [...photos].sort((a, b) => b.votes - a.votes);
}

export async function getGuestVote(dbName: string, guestId: string, missionId: string): Promise<string | undefined> {
  const rows: { photo_id: string }[] = await eventDb(dbName)`
    SELECT photo_id FROM votes WHERE guest_id = ${guestId}::uuid AND mission_id = ${missionId}::uuid
  `;
  return rows[0]?.photo_id;
}

/** Regista ou troca o voto; devolve a missão ou recusa votos fora das regras. */
export async function votePhoto(dbName: string, guestId: string, photoId: string): Promise<string> {
  const db = eventDb(dbName);
  const rows: { mission_id: string; guest_id: string; phase: string }[] = await db`
    SELECT p.mission_id, p.guest_id, m.phase FROM photos p JOIN missions m ON m.id = p.mission_id
    WHERE p.id = ${photoId}::uuid AND NOT p.hidden
  `;
  const photo = rows[0];
  if (!photo || photo.phase !== "votacao") throw new PhotoError("A votação desta missão não está aberta.");
  if (photo.guest_id === guestId) throw new PhotoError("Não podes votar na tua própria fotografia.");
  await db`
    INSERT INTO votes (guest_id, mission_id, photo_id)
    VALUES (${guestId}::uuid, ${photo.mission_id}::uuid, ${photoId}::uuid)
    ON CONFLICT (guest_id, mission_id) DO UPDATE SET photo_id = EXCLUDED.photo_id, created_at = now()
  `;
  return photo.mission_id;
}

export interface NewPhoto {
  guestId: string;
  mission: MissionDetail;
  caption: string;
  bytes: Uint8Array;
}

export async function savePhoto(event: EventRecord, input: NewPhoto): Promise<void> {
  const { guestId, mission, caption, bytes } = input;
  const extension = detectPhoto(bytes);
  if (!extension) throw new PhotoError("Só são aceites fotografias JPG, PNG ou HEIC.");
  if ((await countGuestPhotos(event.db_name, guestId, mission.id)) >= mission.photo_limit) {
    throw new PhotoError("Já atingiste o limite desta missão.");
  }

  const id = randomUUID();
  const path = originalPath(event.id, id, extension);
  await mkdir(photosDir(event.id), { recursive: true });
  await Bun.write(path, bytes);

  try {
    await eventDb(event.db_name).begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`${guestId}:${mission.id}`}))`;
      const [row]: { count: number }[] = await tx`
        SELECT count(*)::int AS count FROM photos
        WHERE guest_id = ${guestId}::uuid AND mission_id = ${mission.id}::uuid
      `;
      if (row!.count >= mission.photo_limit) throw new PhotoError("Já atingiste o limite desta missão.");
      await tx`
        INSERT INTO photos (id, guest_id, mission_id, storage_key, caption, extension, size_bytes)
        VALUES (${id}::uuid, ${guestId}::uuid, ${mission.id}::uuid, ${`${id}.${extension}`},
                ${caption}, ${extension}, ${bytes.length})
      `;
    });
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  schedulePreview(event, id, extension);
}

/** Só o autor apaga e apenas enquanto a missão recebe fotografias. */
export async function deleteOwnPhoto(event: EventRecord, guestId: string, photoId: string): Promise<string | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(photoId)) return undefined;
  const rows: { mission_id: string; extension: string }[] = await eventDb(event.db_name)`
    DELETE FROM photos p USING missions m
    WHERE p.id = ${photoId}::uuid AND p.guest_id = ${guestId}::uuid
      AND m.id = p.mission_id AND m.phase = 'envio'
    RETURNING p.mission_id, p.extension
  `;
  const row = rows[0];
  if (!row) return undefined;
  await removePhotoFiles(event.id, photoId, row.extension);
  return row.mission_id;
}

/** A própria fotografia é sempre visível; as outras só depois de a missão sair da fase de envio. */
export async function canViewPhoto(dbName: string, guestId: string, photoId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(photoId)) return false;
  const rows = await eventDb(dbName)`
    SELECT 1 FROM photos p JOIN missions m ON m.id = p.mission_id
    WHERE p.id = ${photoId}::uuid AND NOT p.hidden AND p.preview_status = 'ready'
      AND (p.guest_id = ${guestId}::uuid OR m.phase <> 'envio')
  `;
  return rows.length > 0;
}
