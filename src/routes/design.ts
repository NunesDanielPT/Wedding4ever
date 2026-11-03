import { eventDesign, saveEventDesign, type EventRecord } from "../db/events";
import { validateDesign, type Design } from "../lib/design";
import { removeMedia, saveMedia, type MediaKind } from "../lib/event-assets";
import { imageExtensionOf, MAX_IMAGE_BYTES, toPdfImage } from "../lib/image";
import * as admin from "../views/admin";
import { field, htmlResponse, redirect } from "./http";

async function storeImage(event: EventRecord, form: FormData, name: string, kind: MediaKind): Promise<Design["logoImage"] | Error> {
  const value = form.get(name);
  if (!(value instanceof Blob) || value.size === 0) return undefined;
  if (value.size > MAX_IMAGE_BYTES) return new Error("Cada imagem pode ter até 8 MB.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  const extension = imageExtensionOf(bytes);
  try {
    if (!extension) throw new Error("Formato não suportado");
    toPdfImage(bytes);
  } catch {
    return new Error("Usa uma imagem JPG ou PNG de 8 bits, sem entrelaçamento e com até 40 megapíxeis.");
  }
  await saveMedia(event.id, kind, extension, bytes);
  return extension;
}

export async function handleDesign(req: Request, event: EventRecord, context: admin.DesignContext): Promise<Response> {
  const form = await req.formData();
  const design: Design = {
    ...eventDesign(event),
    headline: field(form, "headline"),
    instructions: field(form, "instructions"),
    backgroundColor: field(form, "backgroundColor"),
    textColor: field(form, "textColor"),
    accentColor: field(form, "accentColor"),
    qrColor: field(form, "qrColor"),
    qrBackground: field(form, "qrBackground"),
  };
  const error = validateDesign(design);
  if (error) return htmlResponse(admin.designPage(event, design, error, context), 422);

  for (const [input, remove, kind, key] of [
    ["backgroundFile", "removeBackground", "background", "backgroundImage"],
    ["logoFile", "removeLogo", "logo", "logoImage"],
  ] as const) {
    if (form.get(remove)) {
      await removeMedia(event.id, kind);
      design[key] = undefined;
    }
    const stored = await storeImage(event, form, input, kind);
    if (stored instanceof Error) return htmlResponse(admin.designPage(event, design, stored.message, context), 422);
    if (stored) design[key] = stored;
  }
  await saveEventDesign(event.id, design);
  return redirect(`${context.base}/personalizar`);
}
