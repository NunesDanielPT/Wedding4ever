import type { Design } from "./design";
import type { PdfImage } from "./image";
import { createQr, type QrCode } from "./qr";

const MM = 72 / 25.4;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CARD_W = PAGE_W / 2;
const CARD_H = PAGE_H / 2;
/* Larguras oficiais das fontes base do PDF, do espaço (32) ao til (126). */
const TIMES = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541];
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

type Font = "F1" | "F2";

function textWidth(text: string, font: Font, size: number): number {
  const widths = font === "F1" ? TIMES : HELVETICA;
  let total = 0;
  for (const char of text.normalize("NFD").replace(/\p{Diacritic}/gu, "")) {
    total += widths[(char.codePointAt(0) ?? 63) - 32] ?? 500;
  }
  return (total * size) / 1000;
}

/** Converte para Latin-1, que cobre o português; o resto perde o acento ou vira "?". */
function pdfHex(text: string): string {
  let hex = "";
  for (const char of text) {
    let code = char.codePointAt(0) ?? 63;
    if (code > 255 || (code >= 127 && code < 160)) {
      const base = char.normalize("NFD").codePointAt(0) ?? 63;
      code = base < 127 ? base : 63;
    }
    hex += code.toString(16).padStart(2, "0");
  }
  return `<${hex}>`;
}

function centered(text: string, cx: number, y: number, font: Font, size: number, color: string): string {
  const x = cx - textWidth(text, font, size) / 2;
  return `BT /${font} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfHex(text)} Tj ET\n`;
}

function fitSize(text: string, font: Font, size: number, maxWidth: number): number {
  const width = textWidth(text, font, size);
  return width <= maxWidth ? size : Math.floor((size * maxWidth) / width);
}

function color(hex: string): string {
  return [1, 3, 5].map((i) => (Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
}

function fillRect(x: number, y: number, w: number, h: number, hex: string): string {
  return `${color(hex)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`;
}

function qrOps(qr: QrCode, x: number, top: number, width: number, design: Design): string {
  const quiet = 4;
  const module = width / (qr.size + quiet * 2);
  let ops = fillRect(x, top - width, width, width, design.qrBackground) + `${color(design.qrColor)} rg\n`;
  qr.modules.forEach((row, rowIndex) => {
    row.forEach((dark, column) => {
      if (!dark) return;
      const left = x + (column + quiet) * module;
      const bottom = top - (rowIndex + quiet + 1) * module;
      ops += `${left.toFixed(3)} ${bottom.toFixed(3)} ${module.toFixed(3)} ${module.toFixed(3)} re\n`;
    });
  });
  return `${ops}f\n`;
}

/** Cobre a área indicada, centrando a imagem e cortando o excesso. */
function coverImage(name: string, image: PdfImage, x: number, y: number, w: number, h: number): string {
  const scale = Math.max(w / image.width, h / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  return (
    `q ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re W n ` +
    `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${(x + (w - drawW) / 2).toFixed(2)} ${(y + (h - drawH) / 2).toFixed(2)} cm /${name} Do Q\n`
  );
}

function containImage(name: string, image: PdfImage, cx: number, bottom: number, maxW: number, maxH: number): string {
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${(cx - w / 2).toFixed(2)} ${bottom.toFixed(2)} cm /${name} Do Q\n`;
}

export interface CardContent {
  couple: string;
  date: string;
  url: string;
  design: Design;
  background?: PdfImage;
  logo?: PdfImage;
}

function card(originX: number, originY: number, content: CardContent, qr: QrCode): string {
  const { design } = content;
  const inset = 8 * MM;
  const cx = originX + CARD_W / 2;
  const qrWidth = 56 * MM;
  const maxTextWidth = CARD_W - 2 * inset - 12 * MM;
  const display = content.url.replace(/^https?:\/\//, "");
  const text = color(design.textColor);
  const headlineSize = fitSize(design.headline, "F1", 13, maxTextWidth);
  const instructionsSize = fitSize(design.instructions, "F2", 9.5, maxTextWidth);

  return (
    fillRect(originX, originY, CARD_W, CARD_H, design.backgroundColor) +
    (content.background ? coverImage("Bg", content.background, originX, originY, CARD_W, CARD_H) : "") +
    `${color(design.accentColor)} RG 0.75 w ${(originX + inset).toFixed(2)} ${(originY + inset).toFixed(2)} ` +
    `${(CARD_W - 2 * inset).toFixed(2)} ${(CARD_H - 2 * inset).toFixed(2)} re S\n` +
    (content.logo ? containImage("Logo", content.logo, cx, originY + 121 * MM, 60 * MM, 16 * MM) : "") +
    centered(content.couple, cx, originY + 110 * MM, "F1", fitSize(content.couple, "F1", 26, maxTextWidth), text) +
    centered(content.date, cx, originY + 103 * MM, "F1", 11, text) +
    centered(design.headline, cx, originY + 94 * MM, "F1", headlineSize, text) +
    qrOps(qr, cx - qrWidth / 2, originY + 88 * MM, qrWidth, design) +
    centered(design.instructions, cx, originY + 24 * MM, "F2", instructionsSize, text) +
    centered(display, cx, originY + 18 * MM, "F2", fitSize(display, "F2", 8.5, maxTextWidth), text)
  );
}

interface PdfObject {
  dict: string;
  data?: Uint8Array;
}

function imageObjects(objects: PdfObject[], image: PdfImage): number {
  let mask = "";
  if (image.alpha) {
    objects.push({
      dict: `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
      data: image.alpha,
    });
    mask = ` /SMask ${objects.length} 0 R`;
  }
  const decode = image.invert ? " /Decode [1 0 1 0 1 0 1 0]" : "";
  objects.push({
    dict: `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter}${decode}${mask}`,
    data: image.data,
  });
  return objects.length;
}

function serialize(objects: PdfObject[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };

  write("%PDF-1.4\n");
  const offsets = objects.map((object, i) => {
    const offset = length;
    if (object.data) {
      write(`${i + 1} 0 obj\n<< ${object.dict} /Length ${object.data.length} >>\nstream\n`);
      write(object.data);
      write("\nendstream\nendobj\n");
    } else {
      write(`${i + 1} 0 obj\n<< ${object.dict} >>\nendobj\n`);
    }
    return offset;
  });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/** Cria uma folha A4 com quatro cartões A6 para as mesas. */
export function tableCardsPdf(content: CardContent): Uint8Array {
  const qr = createQr(content.url);
  const stream =
    card(0, CARD_H, content, qr) +
    card(CARD_W, CARD_H, content, qr) +
    card(0, 0, content, qr) +
    card(CARD_W, 0, content, qr) +
    `0.8 0.8 0.8 RG 0.25 w [3 3] 0 d ${CARD_W.toFixed(2)} 0 m ${CARD_W.toFixed(2)} ${PAGE_H.toFixed(2)} l S ` +
    `0 ${CARD_H.toFixed(2)} m ${PAGE_W.toFixed(2)} ${CARD_H.toFixed(2)} l S [] 0 d\n`;

  const objects: PdfObject[] = [
    { dict: "/Type /Catalog /Pages 2 0 R" },
    { dict: "/Type /Pages /Kids [3 0 R] /Count 1" },
    { dict: "" },
    { dict: "", data: new TextEncoder().encode(stream) },
    { dict: "/Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding" },
    { dict: "/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding" },
  ];
  const xobjects: string[] = [];
  if (content.background) xobjects.push(`/Bg ${imageObjects(objects, content.background)} 0 R`);
  if (content.logo) xobjects.push(`/Logo ${imageObjects(objects, content.logo)} 0 R`);
  objects[2]!.dict =
    `/Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R ` +
    `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << ${xobjects.join(" ")} >> >>`;
  return serialize(objects);
}
