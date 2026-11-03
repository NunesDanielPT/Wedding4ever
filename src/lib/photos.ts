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
}

export interface MissionDetail {
  id: string;
  title: string;
  photo_limit: number;
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

async function createPreview(event: EventRecord, photoId: string, extension: PhotoExtension): Promise<void> {
  const source = originalPath(event.id, photoId, extension);
  const target = previewPath(event.id, photoId);
  const process = Bun.spawn(
    [
      "convert", "-limit", "memory", "256MiB", "-limit", "map", "512MiB",
      `${IMAGE_CODER[extension]}:${source}[0]`,
      "-auto-orient", "-thumbnail", "1200x1200>", "-strip", "-quality", "80", `jpeg:${target}`,
    ],
    { stdout: "ignore", stderr: "ignore", timeout: CONVERSION_TIMEOUT_MS },
  );
  const status = (await process.exited) === 0 ? "ready" : "failed";
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
    SELECT id, title, photo_limit FROM missions WHERE id = ${id}::uuid AND active
  `;
  return rows[0];
}

export async function countGuestPhotos(dbName: string, guestId: string, missionId: string): Promise<number> {
  const [row]: { count: number }[] = await eventDb(dbName)`
    SELECT count(*)::int AS count FROM photos WHERE guest_id = ${guestId}::uuid AND mission_id = ${missionId}::uuid
  `;
  return row!.count;
}

export async function listMissionPhotos(event: EventRecord, missionId: string): Promise<Photo[]> {
  const rows: (Photo & { extension: PhotoExtension })[] = await eventDb(event.db_name)`
    SELECT p.id, p.guest_id, g.full_name AS guest_name, p.caption, p.preview_status, p.extension
    FROM photos p JOIN guests g ON g.id = p.guest_id
    WHERE p.mission_id = ${missionId}::uuid AND NOT p.hidden
    ORDER BY p.created_at DESC
  `;
  for (const photo of rows) {
    if (photo.preview_status === "pending") schedulePreview(event, photo.id, photo.extension);
  }
  return rows;
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

/** Só o autor apaga a fotografia, e devolve a missão para regressar à página certa. */
export async function deleteOwnPhoto(event: EventRecord, guestId: string, photoId: string): Promise<string | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(photoId)) return undefined;
  const rows: { mission_id: string; extension: string }[] = await eventDb(event.db_name)`
    DELETE FROM photos WHERE id = ${photoId}::uuid AND guest_id = ${guestId}::uuid
    RETURNING mission_id, extension
  `;
  const row = rows[0];
  if (!row) return undefined;
  await rm(originalPath(event.id, photoId, row.extension), { force: true });
  await rm(previewPath(event.id, photoId), { force: true });
  return row.mission_id;
}

export async function isVisiblePhoto(dbName: string, photoId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(photoId)) return false;
  const rows = await eventDb(dbName)`
    SELECT 1 FROM photos WHERE id = ${photoId}::uuid AND NOT hidden AND preview_status = 'ready'
  `;
  return rows.length > 0;
}
