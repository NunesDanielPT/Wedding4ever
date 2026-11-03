import { createQr, type QrCode } from "./qr";

const MM = 72 / 25.4;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CARD_W = PAGE_W / 2;
const CARD_H = PAGE_H / 2;
const NAVY = "0.122 0.2 0.314";
const GOLD = "0.663 0.541 0.294";
const GRAPHITE = "0.2 0.216 0.231";

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

function qrOps(qr: QrCode, x: number, top: number, width: number): string {
  const module = width / qr.size;
  let ops = `${NAVY} rg\n`;
  qr.modules.forEach((row, rowIndex) => {
    row.forEach((dark, column) => {
      if (!dark) return;
      const left = x + column * module;
      const bottom = top - (rowIndex + 1) * module;
      ops += `${left.toFixed(3)} ${bottom.toFixed(3)} ${module.toFixed(3)} ${module.toFixed(3)} re\n`;
    });
  });
  return `${ops}f\n`;
}

export interface CardContent {
  couple: string;
  date: string;
  url: string;
}

function card(originX: number, originY: number, content: CardContent, qr: QrCode): string {
  const inset = 8 * MM;
  const cx = originX + CARD_W / 2;
  const qrWidth = 56 * MM;
  const maxTextWidth = CARD_W - 2 * inset - 12 * MM;
  const coupleSize = fitSize(content.couple, "F1", 26, maxTextWidth);
  const display = content.url.replace(/^https?:\/\//, "");
  const urlSize = fitSize(display, "F2", 8.5, maxTextWidth);
  const qrTop = originY + 86 * MM;

  return (
    `${GOLD} RG 0.75 w ${(originX + inset).toFixed(2)} ${(originY + inset).toFixed(2)} ` +
    `${(CARD_W - 2 * inset).toFixed(2)} ${(CARD_H - 2 * inset).toFixed(2)} re S\n` +
    centered(content.couple, cx, originY + CARD_H - 32 * MM, "F1", coupleSize, NAVY) +
    centered(content.date, cx, originY + CARD_H - 40 * MM, "F1", 11, GRAPHITE) +
    qrOps(qr, cx - qrWidth / 2, qrTop, qrWidth) +
    centered("Aponte a câmara para entrar na Batalha da Melhor Foto", cx, originY + 22 * MM,
      "F2", fitSize("Aponte a câmara para entrar na Batalha da Melhor Foto", "F2", 9.5, maxTextWidth), GRAPHITE) +
    centered(display, cx, originY + 16.5 * MM, "F2", urlSize, NAVY)
  );
}

/** Cria uma folha A4 com quatro cartões A6 para as mesas. */
export function tableCardsPdf(content: CardContent): Uint8Array {
  const qr = createQr(content.url);
  const stream =
    `0.8 0.8 0.8 RG 0.25 w [3 3] 0 d ${CARD_W.toFixed(2)} 0 m ${CARD_W.toFixed(2)} ${PAGE_H.toFixed(2)} l S ` +
    `0 ${CARD_H.toFixed(2)} m ${PAGE_W.toFixed(2)} ${CARD_H.toFixed(2)} l S [] 0 d\n` +
    card(0, CARD_H, content, qr) +
    card(CARD_W, CARD_H, content, qr) +
    card(0, 0, content, qr) +
    card(CARD_W, 0, content, qr);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents 4 0 R ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
