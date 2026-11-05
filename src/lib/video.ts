import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { central } from "../db/central";
import { eventDb, getEventById, type EventRecord } from "../db/events";
import { resolveDesign } from "./design";
import { formatDate } from "./format";
import { previewPath } from "./photos";

export const MAX_MUSIC_BYTES = 25 * 1024 * 1024;
export const VIDEO_LENGTHS = [20, 40, 60] as const;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 25;
const HOLD_FRAMES = 80;
const FADE_FRAMES = 20;
const STEP_TIMEOUT_MS = 180_000;
const SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf";
const SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-bf", "0", "-pix_fmt", "yuv420p", "-threads", "2"];

export class VideoError extends Error {}

export interface MusicTrack {
  id: string;
  name: string;
  extension: string;
  duration: number;
}

export interface EventVideo {
  status: "na_fila" | "a_gerar" | "pronto" | "erro";
  music_id: string | null;
  max_photos: number;
  progress: number;
  photos: number;
  duration: number;
  bytes: number;
  has_file: boolean;
  error: string;
}

export interface VideoPhoto {
  id: string;
  mission_id: string;
  title: string;
  position: number;
  guest_name: string;
  votes: number;
  winner: boolean;
}

function musicDir(): string {
  return join(config.storageDir, "music");
}

export function musicPath(track: Pick<MusicTrack, "id" | "extension">): string {
  return join(musicDir(), `${track.id}.${track.extension}`);
}

export function videoPath(eventId: string): string {
  return join(config.storageDir, "events", eventId, "video.mp4");
}

function workRoot(): string {
  return join(config.storageDir, "video-work");
}

/** Identifica o áudio pelo conteúdo, porque o nome do ficheiro pode ser falso. */
export function detectAudio(bytes: Uint8Array): "mp3" | "m4a" | "wav" | "ogg" | undefined {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 12));
  if (text.startsWith("ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  if (text.slice(4, 8) === "ftyp") return "m4a";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE") return "wav";
  if (text.startsWith("OggS")) return "ogg";
  return undefined;
}

async function run(args: string[], cwd?: string): Promise<string> {
  const child = Bun.spawn(["nice", "-n", "10", ...args], { cwd, stdout: "pipe", stderr: "pipe", timeout: STEP_TIMEOUT_MS });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) {
    console.error(`Falha em ${args[0]}: ${err.slice(-800)}`);
    throw new VideoError(`O ${args[0]} terminou com erro.`);
  }
  return out;
}

async function audioDuration(path: string): Promise<number> {
  const out = await run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "default=nw=1", path]);
  const seconds = Number(out.match(/duration=([\d.]+)/)?.[1]);
  if (!out.includes("codec_type=audio") || !(seconds > 0)) throw new VideoError("Não encontrei áudio neste ficheiro.");
  return Math.round(seconds);
}

export async function listMusic(): Promise<MusicTrack[]> {
  return central`SELECT id, name, extension, duration FROM video_music ORDER BY created_at DESC`;
}

export async function getMusic(id: string): Promise<MusicTrack | undefined> {
  const rows: MusicTrack[] = await central`SELECT id, name, extension, duration FROM video_music WHERE id = ${id}::uuid`;
  return rows[0];
}

export async function addMusic(file: File, name: string): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = detectAudio(bytes);
  if (!extension) throw new VideoError("Usa um ficheiro MP3, M4A, WAV ou OGG.");
  const id = randomUUID();
  const path = musicPath({ id, extension });
  await mkdir(musicDir(), { recursive: true });
  await Bun.write(path, bytes);
  try {
    const duration = await audioDuration(path);
    await central`
      INSERT INTO video_music (id, name, extension, duration)
      VALUES (${id}::uuid, ${name.slice(0, 120)}, ${extension}, ${duration})
    `;
  } catch (cause) {
    await rm(path, { force: true });
    if (cause instanceof VideoError) throw new VideoError("Não consegui ler este ficheiro de áudio.");
    throw cause;
  }
}

export async function removeMusic(id: string): Promise<boolean> {
  const rows: MusicTrack[] = await central`DELETE FROM video_music WHERE id = ${id}::uuid RETURNING id, name, extension, duration`;
  const track = rows[0];
  if (track) await rm(musicPath(track), { force: true });
  return Boolean(track);
}

export async function getEventVideo(eventId: string): Promise<EventVideo | undefined> {
  const rows: EventVideo[] = await central`
    SELECT status, music_id, max_photos, progress, photos, duration, bytes::int AS bytes, has_file, error
    FROM event_videos WHERE event_id = ${eventId}::uuid
  `;
  return rows[0];
}

async function listVideoPhotos(dbName: string): Promise<VideoPhoto[]> {
  return eventDb(dbName)`
    WITH counted AS (
      SELECT m.id AS mission_id, m.title, m.position, m.phase, p.id, g.full_name AS guest_name,
             p.created_at, count(v.photo_id)::int AS votes
      FROM missions m
      JOIN photos p ON p.mission_id = m.id AND NOT p.hidden AND p.preview_status = 'ready'
      JOIN guests g ON g.id = p.guest_id
      LEFT JOIN votes v ON v.photo_id = p.id
      GROUP BY m.id, p.id, g.full_name
    )
    SELECT id, mission_id, title, position, guest_name, votes,
           phase = 'encerrada' AND votes > 0 AND votes = max(votes) OVER (PARTITION BY mission_id) AS winner
    FROM counted
    ORDER BY position, votes DESC, created_at
  `;
}

export async function countVideoPhotos(dbName: string): Promise<number> {
  return (await listVideoPhotos(dbName)).length;
}

/**
 * Reparte o limite pelas missões, começando pelas fotos mais votadas de cada uma.
 * Dentro de cada missão, a mais votada fica no fim, para o vídeo acabar nas vencedoras.
 */
export function pickVideoPhotos(photos: VideoPhoto[], limit: number): VideoPhoto[] {
  const missions = new Map<string, VideoPhoto[]>();
  for (const photo of photos) missions.set(photo.mission_id, [...(missions.get(photo.mission_id) ?? []), photo]);
  const picked = new Set<VideoPhoto>();
  for (let round = 0; picked.size < Math.min(limit, photos.length); round++) {
    for (const list of missions.values()) {
      const photo = list[round];
      if (photo && picked.size < limit) picked.add(photo);
    }
  }
  return [...picked].sort((a, b) => a.position - b.position || a.votes - b.votes);
}

/** Tira emojis e outros caracteres que a fonte não desenha. */
function printable(text: string): string {
  return text.replace(/[^\p{L}\p{N}\p{P}\p{Zs}+=$€£~^|<>]/gu, "").replace(/\s+/g, " ").trim();
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? `0x${value.slice(1)}` : fallback;
}

/** O texto vai por ficheiro e com expansion=none, por isso nunca é lido como filtro do ffmpeg. */
async function textFilter(dir: string, key: string, text: string, font: string, size: number, color: string, y: number): Promise<string> {
  const name = `${key}.txt`;
  await Bun.write(join(dir, name), text);
  return `drawtext=fontfile=${font}:textfile=${name}:expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}`;
}

interface Card {
  title: string;
  subtitle?: string;
}

async function renderCard(dir: string, index: number, card: Card, colors: { background: string; text: string; accent: string }): Promise<void> {
  const clean = printable(card.title) || " ";
  const lines = wrap(clean, 28);
  const size = Math.min(110, Math.floor(1500 / (Math.max(...lines.map((line) => line.length)) * 0.62)));
  const lineHeight = Math.round(size * 1.3);
  const top = Math.round(HEIGHT / 2 - (lines.length * lineHeight) / 2 - 30);
  const filters: string[] = [];
  for (const [i, line] of lines.entries()) {
    filters.push(await textFilter(dir, `c${index}-${i}`, line, SERIF, size, colors.text, top + i * lineHeight));
  }
  const ruleY = top + lines.length * lineHeight + 26;
  filters.push(`drawbox=x=${WIDTH / 2 - 70}:y=${ruleY}:w=140:h=3:color=${colors.accent}:t=fill`);
  if (card.subtitle) filters.push(await textFilter(dir, `c${index}-s`, printable(card.subtitle), SANS, 38, colors.accent, ruleY + 34));
  await run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colors.background}:s=${WIDTH}x${HEIGHT}`,
    "-vf", filters.join(","), "-frames:v", "1", "-q:v", "2", "-update", "1", `s${index}.jpg`], dir);
}

async function renderPhoto(dir: string, index: number, source: string, caption: string | undefined): Promise<void> {
  const graph =
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=28:2,eq=brightness=-0.2[bg];` +
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  let filter = graph;
  if (caption) {
    filter += `,drawbox=x=0:y=${HEIGHT - 150}:w=${WIDTH}:h=150:color=black@0.55:t=fill,`;
    filter += await textFilter(dir, `p${index}`, printable(caption), SERIF, 52, "white", HEIGHT - 108);
  }
  await run(["ffmpeg", "-v", "error", "-y", "-i", source, "-filter_complex", filter, "-frames:v", "1", "-q:v", "2", "-update", "1", `s${index}.jpg`], dir);
}

async function encodeHold(dir: string, index: number): Promise<void> {
  await run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", String(FPS), "-i", `s${index}.jpg`,
    "-frames:v", String(HOLD_FRAMES), "-vf", "scale=in_range=pc:out_range=tv", ...X264, `hold${index}.mp4`], dir);
}

async function encodeFade(dir: string, index: number): Promise<void> {
  const seconds = FADE_FRAMES / FPS;
  await run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", String(FPS), "-i", `s${index}.jpg`,
    "-loop", "1", "-framerate", String(FPS), "-i", `s${index + 1}.jpg`,
    "-filter_complex", `[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]xfade=transition=fade:duration=${seconds}:offset=0,scale=in_range=pc:out_range=tv`,
    "-frames:v", String(FADE_FRAMES), ...X264, `fade${index}.mp4`], dir);
}

function buildCards(event: EventRecord, photos: VideoPhoto[]): (Card | VideoPhoto)[] {
  const slides: (Card | VideoPhoto)[] = [{ title: event.name, subtitle: formatDate(event.event_date) }];
  let mission = "";
  for (const photo of photos) {
    if (photo.mission_id !== mission) {
      slides.push({ title: photo.title });
      mission = photo.mission_id;
    }
    slides.push(photo);
  }
  slides.push({ title: "Obrigado por fazerem parte", subtitle: event.name });
  return slides;
}

async function setProgress(eventId: string, progress: number): Promise<void> {
  await central`UPDATE event_videos SET progress = ${progress}, updated_at = now() WHERE event_id = ${eventId}::uuid`;
}

async function buildVideo(event: EventRecord, track: MusicTrack | undefined, maxPhotos: number): Promise<{ photos: number; duration: number }> {
  const photos = pickVideoPhotos(await listVideoPhotos(event.db_name), maxPhotos);
  if (photos.length === 0) throw new VideoError("Este evento não tem fotografias para o vídeo.");
  const design = resolveDesign(event.design);
  const colors = {
    background: safeColor(design.backgroundColor, "0xFBF8F1"),
    text: safeColor(design.textColor, "0x33373B"),
    accent: safeColor(design.accentColor, "0xA98A4B"),
  };
  const dir = join(workRoot(), event.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    const slides = buildCards(event, photos);
    const parts: string[] = [];
    for (const [i, slide] of slides.entries()) {
      if ("id" in slide) {
        await renderPhoto(dir, i, previewPath(event.id, slide.id), slide.winner ? `Vencedor: ${slide.guest_name}` : undefined);
      } else await renderCard(dir, i, slide, colors);
      await encodeHold(dir, i);
      if (i > 0) {
        await encodeFade(dir, i - 1);
        parts.push(`file fade${i - 1}.mp4`);
      }
      parts.push(`file hold${i}.mp4`);
      await setProgress(event.id, Math.round(((i + 1) / slides.length) * 95));
    }
    await Bun.write(join(dir, "list.txt"), `${parts.join("\n")}\n`);
    const duration = (slides.length * HOLD_FRAMES + (slides.length - 1) * FADE_FRAMES) / FPS;
    const audio = track
      ? ["-stream_loop", "-1", "-i", musicPath(track), "-af", `afade=t=out:st=${Math.max(0, duration - 3)}:d=3`, "-c:a", "aac", "-b:a", "192k", "-t", String(duration)]
      : [];
    await run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", ...audio, "-c:v", "copy", "-movflags", "+faststart", "final.mp4"], dir);
    await rename(join(dir, "final.mp4"), videoPath(event.id));
    return { photos: photos.length, duration: Math.round(duration) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const queue: string[] = [];
let working = false;

async function processVideo(eventId: string): Promise<void> {
  const rows: { music_id: string | null; max_photos: number }[] = await central`
    UPDATE event_videos SET status = 'a_gerar', updated_at = now()
    WHERE event_id = ${eventId}::uuid AND status = 'na_fila' RETURNING music_id, max_photos
  `;
  const job = rows[0];
  const event = await getEventById(eventId);
  if (!job || !event) return;
  try {
    const track = job.music_id ? await getMusic(job.music_id) : undefined;
    const result = await buildVideo(event, track, job.max_photos);
    const { size } = await stat(videoPath(eventId));
    await central`
      UPDATE event_videos SET status = 'pronto', progress = 100, photos = ${result.photos}, duration = ${result.duration},
        bytes = ${size}, has_file = true, error = '', updated_at = now()
      WHERE event_id = ${eventId}::uuid
    `;
  } catch (cause) {
    console.error(`Falha ao gerar o vídeo de ${eventId}`, cause);
    const message = cause instanceof VideoError ? cause.message : "Não foi possível gerar o vídeo.";
    await central`UPDATE event_videos SET status = 'erro', error = ${message}, updated_at = now() WHERE event_id = ${eventId}::uuid`;
  }
}

async function pump(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length > 0) await processVideo(queue.shift()!);
  } finally {
    working = false;
  }
}

/** Devolve false se este evento já tiver um vídeo na fila ou a gerar. */
export async function requestVideo(eventId: string, musicId: string | null, maxPhotos: number): Promise<boolean> {
  const rows = await central`
    INSERT INTO event_videos (event_id, status, music_id, max_photos)
    VALUES (${eventId}::uuid, 'na_fila', ${musicId}::uuid, ${maxPhotos})
    ON CONFLICT (event_id) DO UPDATE SET status = 'na_fila', music_id = EXCLUDED.music_id,
      max_photos = EXCLUDED.max_photos, progress = 0, error = '', updated_at = now()
    WHERE event_videos.status NOT IN ('na_fila', 'a_gerar')
    RETURNING event_id
  `;
  if (rows.length === 0) return false;
  queue.push(eventId);
  void pump();
  return true;
}

export async function deleteVideo(eventId: string): Promise<boolean> {
  const rows = await central`
    DELETE FROM event_videos WHERE event_id = ${eventId}::uuid AND status NOT IN ('na_fila', 'a_gerar') RETURNING event_id
  `;
  if (rows.length === 0) return false;
  await rm(videoPath(eventId), { force: true });
  return true;
}

/** Ao arrancar não há nada a correr: limpa restos e marca o que ficou a meio. */
export async function recoverVideos(): Promise<void> {
  await rm(workRoot(), { recursive: true, force: true });
  await central`
    UPDATE event_videos SET status = 'erro', error = 'O servidor reiniciou durante a geração. Gera o vídeo outra vez.', updated_at = now()
    WHERE status IN ('na_fila', 'a_gerar')
  `;
}

/** Serve ficheiros de média com pedidos parciais, necessários para os leitores do Safari e do iPhone. */
export async function mediaResponse(req: Request, path: string, type: string, download?: string): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Não encontrado", { status: 404 });
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download}"`;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range || (!range[1] && !range[2])) {
    return new Response(file, { headers: { ...headers, "Content-Length": String(file.size) } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) },
  });
}
