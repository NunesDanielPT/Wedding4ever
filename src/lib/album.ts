import type { EventRecord } from "../db/events";
import { listAlbum } from "./missions";
import { originalPath } from "./photos";
import { zipStream } from "./zip";

const MAX_GUEST_DOWNLOADS = 3;
let active = 0;

function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/^\.+/, "").trim().slice(0, 60) || "sem nome";
}

export async function albumZip(event: EventRecord, onClose?: () => void): Promise<Response> {
  const album = await listAlbum(event.db_name);
  const entries = album.map((photo, index) => ({
    name: `${String(photo.mission_position + 1).padStart(2, "0")} ${safeName(photo.mission_title)}/${String(index + 1).padStart(4, "0")} ${safeName(photo.guest_name)}.${photo.extension}`,
    path: originalPath(event.id, photo.id, photo.extension),
  }));
  return new Response(zipStream(entries, undefined, onClose), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="album-${event.slug}.zip"`,
    },
  });
}

/** Limita os downloads dos convidados em simultâneo, para o servidor continuar a responder. */
export async function guestAlbumZip(event: EventRecord): Promise<Response | null> {
  if (active >= MAX_GUEST_DOWNLOADS) return null;
  active++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      active--;
    }
  };
  try {
    return await albumZip(event, release);
  } catch (error) {
    release();
    throw error;
  }
}
