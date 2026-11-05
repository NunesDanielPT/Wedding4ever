import { eventDb, type EventRecord } from "../db/events";
import { removePhotoFiles, type PhotoExtension } from "./photos";

export const MISSION_PHASES = ["envio", "votacao", "encerrada"] as const;
export type MissionPhase = (typeof MISSION_PHASES)[number];
export const MAX_TITLE_LENGTH = 120;

export const PHASE_LABELS: Record<MissionPhase, string> = {
  envio: "Envio de fotografias",
  votacao: "Votação",
  encerrada: "Encerrada",
};

export interface AdminMission {
  id: string;
  title: string;
  position: number;
  photo_limit: number;
  phase: MissionPhase;
  photos: number;
  votes: number;
}

export async function listAdminMissions(dbName: string): Promise<AdminMission[]> {
  return eventDb(dbName)`
    SELECT m.id, m.title, m.position, m.photo_limit, m.phase,
           (SELECT count(*)::int FROM photos p WHERE p.mission_id = m.id) AS photos,
           (SELECT count(*)::int FROM votes v WHERE v.mission_id = m.id) AS votes
    FROM missions m ORDER BY m.position, m.created_at
  `;
}

export async function addMission(dbName: string, title: string, photoLimit: number): Promise<void> {
  await eventDb(dbName)`
    INSERT INTO missions (title, position, photo_limit)
    VALUES (${title}, (SELECT COALESCE(max(position), -1) + 1 FROM missions), ${photoLimit})
  `;
}

export async function updateMission(dbName: string, id: string, title: string, photoLimit: number, phase: MissionPhase) {
  await eventDb(dbName)`
    UPDATE missions SET title = ${title}, photo_limit = ${photoLimit}, phase = ${phase} WHERE id = ${id}::uuid
  `;
}

export async function setMissionPhase(dbName: string, id: string, phase: MissionPhase): Promise<void> {
  await eventDb(dbName)`UPDATE missions SET phase = ${phase} WHERE id = ${id}::uuid`;
}

export async function moveMission(dbName: string, id: string, direction: -1 | 1): Promise<void> {
  const db = eventDb(dbName);
  await db.begin(async (tx) => {
    const rows: { id: string }[] = await tx`SELECT id FROM missions ORDER BY position, created_at FOR UPDATE`;
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    for (const [position, missionId] of ids.entries()) {
      await tx`UPDATE missions SET position = ${position} WHERE id = ${missionId}::uuid`;
    }
  });
}

/** Apaga a missão, as fotografias e os votos dela. */
export async function deleteMission(event: EventRecord, id: string): Promise<void> {
  const db = eventDb(event.db_name);
  const photos: { id: string; extension: string }[] = await db`
    SELECT id, extension FROM photos WHERE mission_id = ${id}::uuid
  `;
  await db`DELETE FROM missions WHERE id = ${id}::uuid`;
  await Promise.all(photos.map((photo) => removePhotoFiles(event.id, photo.id, photo.extension)));
}


export interface WinnerPhoto {
  id: string;
  guest_name: string;
  caption: string;
  votes: number;
}

export interface MissionWinners {
  id: string;
  title: string;
  photos: WinnerPhoto[];
}

/** Devolve as mais votadas de cada missão encerrada; num empate ficam todas. */
export async function getWinners(dbName: string): Promise<MissionWinners[]> {
  const rows: (WinnerPhoto & { mission_id: string; title: string })[] = await eventDb(dbName)`
    SELECT mission_id, title, id, guest_name, caption, votes FROM (
      SELECT m.id AS mission_id, m.title, m.position, p.id, g.full_name AS guest_name, p.caption,
             count(v.photo_id)::int AS votes,
             rank() OVER (PARTITION BY m.id ORDER BY count(v.photo_id) DESC) AS place
      FROM missions m
      JOIN photos p ON p.mission_id = m.id AND NOT p.hidden AND p.preview_status = 'ready'
      JOIN guests g ON g.id = p.guest_id
      LEFT JOIN votes v ON v.photo_id = p.id
      WHERE m.phase = 'encerrada'
      GROUP BY m.id, p.id, g.full_name
    ) ranked
    WHERE place = 1 AND votes > 0
    ORDER BY position, id
  `;
  const missions = new Map<string, MissionWinners>();
  for (const { mission_id, title, ...photo } of rows) {
    const mission = missions.get(mission_id) ?? { id: mission_id, title, photos: [] };
    mission.photos.push(photo);
    missions.set(mission_id, mission);
  }
  return [...missions.values()];
}

export interface AlbumPhoto {
  id: string;
  mission_title: string;
  mission_position: number;
  guest_name: string;
  caption: string;
  extension: PhotoExtension;
  preview_status: "pending" | "ready" | "failed";
}

export async function listAlbum(dbName: string): Promise<AlbumPhoto[]> {
  return eventDb(dbName)`
    SELECT p.id, m.title AS mission_title, m.position AS mission_position, g.full_name AS guest_name,
           p.caption, p.extension, p.preview_status
    FROM photos p JOIN missions m ON m.id = p.mission_id JOIN guests g ON g.id = p.guest_id
    WHERE NOT p.hidden ORDER BY m.position, m.created_at, p.created_at
  `;
}

export interface AlbumMission {
  id: string;
  title: string;
  photos: number;
  cover: string | null;
}

/** Resumo da galeria: conta as fotografias sem ler o álbum inteiro. */
export async function listAlbumMissions(dbName: string): Promise<AlbumMission[]> {
  return eventDb(dbName)`
    SELECT m.id, m.title,
           (SELECT count(*)::int FROM photos p WHERE p.mission_id = m.id AND NOT p.hidden) AS photos,
           (SELECT p.id FROM photos p WHERE p.mission_id = m.id AND NOT p.hidden AND p.preview_status = 'ready'
            ORDER BY p.created_at LIMIT 1) AS cover
    FROM missions m ORDER BY m.position, m.created_at
  `;
}

export interface AlbumPage {
  mission: { id: string; title: string };
  photos: (Pick<AlbumPhoto, "id" | "guest_name" | "caption" | "preview_status" | "extension"> & { hidden: boolean })[];
  total: number;
}

export async function getAlbumPage(dbName: string, missionId: string, page: number, size: number, search: string, includeHidden = false): Promise<AlbumPage | undefined> {
  const db = eventDb(dbName);
  const missions: { id: string; title: string }[] = await db`SELECT id, title FROM missions WHERE id = ${missionId}::uuid`;
  const mission = missions[0];
  if (!mission) return undefined;
  const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const [count]: { total: number }[] = await db`
    SELECT count(*)::int AS total FROM photos p JOIN guests g ON g.id = p.guest_id
    WHERE p.mission_id = ${missionId}::uuid AND (${includeHidden} OR NOT p.hidden) AND g.full_name ILIKE ${like}
  `;
  const photos: AlbumPage["photos"] = await db`
    SELECT p.id, g.full_name AS guest_name, p.caption, p.preview_status, p.extension, p.hidden
    FROM photos p JOIN guests g ON g.id = p.guest_id
    WHERE p.mission_id = ${missionId}::uuid AND (${includeHidden} OR NOT p.hidden) AND g.full_name ILIKE ${like}
    ORDER BY p.created_at, p.id LIMIT ${size} OFFSET ${(page - 1) * size}
  `;
  return { mission, photos, total: count!.total };
}

export async function isAlbumPhoto(dbName: string, photoId: string, includeHidden = false): Promise<boolean> {
  const rows = await eventDb(dbName)`
    SELECT 1 FROM photos WHERE id = ${photoId}::uuid AND (${includeHidden} OR NOT hidden) AND preview_status = 'ready'
  `;
  return rows.length > 0;
}

export async function setPhotoHidden(dbName: string, photoId: string, hidden: boolean): Promise<string | undefined> {
  const rows: { mission_id: string }[] = await eventDb(dbName)`
    UPDATE photos SET hidden = ${hidden} WHERE id = ${photoId}::uuid RETURNING mission_id
  `;
  return rows[0]?.mission_id;
}

export async function deletePhotoAsManager(event: EventRecord, photoId: string): Promise<string | undefined> {
  const rows: { mission_id: string; extension: string }[] = await eventDb(event.db_name)`
    DELETE FROM photos WHERE id = ${photoId}::uuid RETURNING mission_id, extension
  `;
  const row = rows[0];
  if (!row) return undefined;
  await removePhotoFiles(event.id, photoId, row.extension);
  return row.mission_id;
}
