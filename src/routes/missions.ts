import { setPhotoLimit, type EventRecord } from "../db/events";
import {
  addMission,
  deleteMission,
  listAdminMissions,
  MAX_TITLE_LENGTH,
  MISSION_PHASES,
  moveMission,
  updateMission,
  type MissionPhase,
} from "../lib/missions";
import { getSettings, parsePhotoLimit } from "../lib/settings";
import { missionsPage, type MissionsContext } from "../views/admin";
import { field, htmlResponse, notFound, redirect } from "./http";

async function render(event: EventRecord, context: MissionsContext, error?: string, status = 200): Promise<Response> {
  return htmlResponse(missionsPage(event, await listAdminMissions(event.db_name), error, context), status);
}

export async function handleMissions(req: Request, event: EventRecord, action: string, context: MissionsContext): Promise<Response> {
  const back = redirect(`${context.base}/missoes`);
  const titleError = `O nome da missão tem de ter entre 1 e ${MAX_TITLE_LENGTH} caracteres.`;

  if (action === "missoes") {
    if (req.method === "GET") return render(event, context);
    if (req.method !== "POST") return notFound();
    const title = field(await req.formData(), "title");
    if (!title || title.length > MAX_TITLE_LENGTH) return render(event, context, titleError, 422);
    await addMission(event.db_name, title, (await getSettings()).defaultPhotoLimit);
    return back;
  }

  if (action === "missoes/limite" && req.method === "POST") {
    const limit = parsePhotoLimit(field(await req.formData(), "photoLimit"));
    if (!limit) return render(event, context, "Escolhe um limite de fotografias entre 1 e 50.", 422);
    await setPhotoLimit(event.db_name, limit);
    return back;
  }

  const match = action.match(/^missoes\/([0-9a-f-]{36})\/(guardar|subir|descer|apagar)$/);
  if (!match || req.method !== "POST") return notFound();
  const [, missionId, operation] = match as unknown as [string, string, string];

  if (operation === "subir" || operation === "descer") {
    await moveMission(event.db_name, missionId, operation === "subir" ? -1 : 1);
    return back;
  }
  const form = await req.formData();
  if (operation === "apagar") {
    const mission = (await listAdminMissions(event.db_name)).find((item) => item.id === missionId);
    if (!mission) return notFound();
    if (mission.photos > 0 && !form.get("confirm")) {
      return render(event, context, "Confirma que queres apagar a missão e as fotografias dela.", 422);
    }
    await deleteMission(event, missionId);
    return back;
  }

  const title = field(form, "title");
  const limit = parsePhotoLimit(field(form, "photoLimit"));
  const phase = field(form, "phase") as MissionPhase;
  if (!title || title.length > MAX_TITLE_LENGTH) return render(event, context, titleError, 422);
  if (!limit) return render(event, context, "Escolhe um limite de fotografias entre 1 e 50.", 422);
  if (!MISSION_PHASES.includes(phase)) return render(event, context, "Escolhe uma fase válida.", 422);
  await updateMission(event.db_name, missionId, title, limit, phase);
  return back;
}
