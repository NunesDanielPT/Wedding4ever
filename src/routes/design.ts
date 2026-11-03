import { eventDesign, saveEventDesign, type EventRecord } from "../db/events";
import { BORDERS, COLOR_PRESETS, DEFAULT_DESIGN, FONTS, QR_SIZES, validateDesign, type BorderStyle, type Design, type DesignFont, type QrSize } from "../lib/design";
import { normalizeDesignImage, removeMedia, saveMedia, type MediaKind } from "../lib/event-assets";
import { MAX_IMAGE_BYTES, toPdfImage } from "../lib/image";
import * as admin from "../views/admin";
import { field, htmlResponse, redirect } from "./http";

async function storeImage(event: EventRecord, form: FormData, name: string, kind: MediaKind): Promise<Design["logoImage"] | Error> {
  const value = form.get(name);
  if (!(value instanceof Blob) || value.size === 0) return undefined;
  if (value.size > MAX_IMAGE_BYTES) return new Error("Cada imagem pode ter até 20 MB.");
  const image = await normalizeDesignImage(new Uint8Array(await value.arrayBuffer()), kind);
  try {
    if (!image) throw new Error("Formato não suportado");
    toPdfImage(image.bytes);
  } catch {
    return new Error("Não foi possível usar essa imagem. Experimenta um ficheiro JPG, PNG, HEIC ou WEBP.");
  }
  await saveMedia(event.id, kind, image.extension, image.bytes);
  return image.extension;
}

export async function handleDesign(req: Request, event: EventRecord, context: admin.DesignContext): Promise<Response> {
  const form = await req.formData();
  const saved = `${context.base}/personalizar?guardado=1`;
  const preset = field(form, "preset");
  if (preset === "tudo") {
    await saveEventDesign(event.id, {
      ...DEFAULT_DESIGN,
      backgroundImage: eventDesign(event).backgroundImage,
      logoImage: eventDesign(event).logoImage,
    });
    return redirect(saved);
  }
  const palette = COLOR_PRESETS.find((item) => item.id === preset);
  if (palette) {
    await saveEventDesign(event.id, { ...eventDesign(event), ...palette.colors });
    return redirect(saved);
  }

  const design: Design = {
    ...eventDesign(event),
    headline: field(form, "headline"),
    instructions: field(form, "instructions"),
    backgroundColor: field(form, "backgroundColor"),
    textColor: field(form, "textColor"),
    accentColor: field(form, "accentColor"),
    qrColor: field(form, "qrColor"),
    qrBackground: field(form, "qrBackground"),
    font: (field(form, "font") as DesignFont) in FONTS ? (field(form, "font") as DesignFont) : DEFAULT_DESIGN.font,
    borderStyle: (field(form, "borderStyle") as BorderStyle) in BORDERS ? (field(form, "borderStyle") as BorderStyle) : DEFAULT_DESIGN.borderStyle,
    qrSize: (field(form, "qrSize") as QrSize) in QR_SIZES ? (field(form, "qrSize") as QrSize) : DEFAULT_DESIGN.qrSize,
    overlay: Number(field(form, "overlay") || 0),
    showDate: form.get("showDate") !== null,
    showUrl: form.get("showUrl") !== null,
    extraText: field(form, "extraText"),
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
  return redirect(saved);
}
