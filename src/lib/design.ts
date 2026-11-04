export type ImageExtension = "jpg" | "png";

export const FONTS = { classica: "Clássica", moderna: "Moderna", maquina: "Máquina de escrever" } as const;
export const BORDERS = { dupla: "Dupla", simples: "Simples", nenhuma: "Sem moldura" } as const;
export const QR_SIZES = { pequeno: "Pequeno", medio: "Médio", grande: "Grande" } as const;
export type DesignFont = keyof typeof FONTS;
export type BorderStyle = keyof typeof BORDERS;
export type QrSize = keyof typeof QR_SIZES;

export interface Design {
  headline: string;
  instructions: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  qrColor: string;
  qrBackground: string;
  font: DesignFont;
  borderStyle: BorderStyle;
  overlay: number;
  qrSize: QrSize;
  showDate: boolean;
  showUrl: boolean;
  extraText: string;
  monogram: string;
  backgroundImage?: ImageExtension;
  logoImage?: ImageExtension;
}

export const DEFAULT_DESIGN: Design = {
  headline: "Batalha da Melhor Foto",
  instructions: "Aponte a câmara para entrar",
  backgroundColor: "#FBF8F1",
  textColor: "#33373B",
  accentColor: "#A98A4B",
  qrColor: "#1F3350",
  qrBackground: "#FFFFFF",
  font: "classica",
  borderStyle: "dupla",
  overlay: 0,
  qrSize: "medio",
  showDate: true,
  showUrl: true,
  extraText: "",
  monogram: "",
};

type Colors = Pick<Design, "backgroundColor" | "textColor" | "accentColor" | "qrColor" | "qrBackground">;

export const COLOR_PRESETS: { id: string; label: string; colors: Colors }[] = [
  { id: "padrao", label: "Padrão", colors: { backgroundColor: "#FBF8F1", textColor: "#33373B", accentColor: "#A98A4B", qrColor: "#1F3350", qrBackground: "#FFFFFF" } },
  { id: "noite", label: "Noite e ouro", colors: { backgroundColor: "#16233A", textColor: "#F5EFE0", accentColor: "#D9B65C", qrColor: "#16233A", qrBackground: "#FFFFFF" } },
  { id: "oliva", label: "Oliveira", colors: { backgroundColor: "#F3F1E4", textColor: "#333A24", accentColor: "#5F6B35", qrColor: "#2D3A1C", qrBackground: "#FFFFFF" } },
  { id: "rosa", label: "Rosa antigo", colors: { backgroundColor: "#FBF0EE", textColor: "#4A2F35", accentColor: "#B26A78", qrColor: "#4A2F35", qrBackground: "#FFFFFF" } },
  { id: "ceu", label: "Céu", colors: { backgroundColor: "#EEF5FA", textColor: "#23405A", accentColor: "#5C97BF", qrColor: "#23405A", qrBackground: "#FFFFFF" } },
  { id: "menta", label: "Menta", colors: { backgroundColor: "#ECF7F2", textColor: "#1E4A40", accentColor: "#3E9B82", qrColor: "#1E4A40", qrBackground: "#FFFFFF" } },
  { id: "festa", label: "Festa", colors: { backgroundColor: "#FFF4D6", textColor: "#3B1F5B", accentColor: "#E2483D", qrColor: "#3B1F5B", qrBackground: "#FFFFFF" } },
  { id: "preto", label: "Preto e branco", colors: { backgroundColor: "#FFFFFF", textColor: "#111111", accentColor: "#111111", qrColor: "#000000", qrBackground: "#FFFFFF" } },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_FIELDS = ["backgroundColor", "textColor", "accentColor", "qrColor", "qrBackground"] as const;

function imageExtension(value: unknown): ImageExtension | undefined {
  return value === "jpg" || value === "png" ? value : undefined;
}

export function resolveDesign(raw: unknown): Design {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const design: Design = { ...DEFAULT_DESIGN };
  if (typeof stored.headline === "string" && stored.headline) design.headline = stored.headline;
  if (typeof stored.instructions === "string" && stored.instructions) design.instructions = stored.instructions;
  if (typeof stored.extraText === "string") design.extraText = stored.extraText;
  if (typeof stored.monogram === "string") design.monogram = stored.monogram;
  if (typeof stored.font === "string" && stored.font in FONTS) design.font = stored.font as DesignFont;
  if (typeof stored.borderStyle === "string" && stored.borderStyle in BORDERS) design.borderStyle = stored.borderStyle as BorderStyle;
  if (typeof stored.qrSize === "string" && stored.qrSize in QR_SIZES) design.qrSize = stored.qrSize as QrSize;
  if (typeof stored.overlay === "number" && stored.overlay >= 0 && stored.overlay <= 80) design.overlay = stored.overlay;
  if (typeof stored.showDate === "boolean") design.showDate = stored.showDate;
  if (typeof stored.showUrl === "boolean") design.showUrl = stored.showUrl;
  for (const field of COLOR_FIELDS) {
    const value = stored[field];
    if (typeof value === "string" && HEX.test(value)) design[field] = value;
  }
  design.backgroundImage = imageExtension(stored.backgroundImage);
  design.logoImage = imageExtension(stored.logoImage);
  return design;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function validateDesign(design: Design): string | undefined {
  if (!design.headline.trim() || design.headline.length > 60) return "O título tem de ter entre 1 e 60 caracteres.";
  if (!design.instructions.trim() || design.instructions.length > 120) {
    return "A instrução tem de ter entre 1 e 120 caracteres.";
  }
  if (design.monogram.length > 12) return "O texto de destaque pode ter até 12 caracteres.";
  if (design.extraText.length > 120) return "O texto adicional pode ter até 120 caracteres.";
  if (!(design.font in FONTS) || !(design.borderStyle in BORDERS) || !(design.qrSize in QR_SIZES)) return "Escolhe opções válidas.";
  if (!Number.isInteger(design.overlay) || design.overlay < 0 || design.overlay > 80) return "Escolhe um véu entre 0% e 80%.";
  if (COLOR_FIELDS.some((field) => !HEX.test(design[field]))) return "Escolhe cores válidas.";
  if (luminance(design.qrColor) >= luminance(design.qrBackground)) {
    return "O QR Code tem de ser mais escuro do que o fundo, para os telemóveis o conseguirem ler.";
  }
  if (contrastRatio(design.qrColor, design.qrBackground) < 4) {
    return "Aumenta o contraste entre o QR Code e o fundo, para os telemóveis o conseguirem ler.";
  }
  return undefined;
}

export function isHexColor(value: string | null): value is string {
  return value !== null && HEX.test(value);
}

function rgba(hex: string, percent: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${percent / 100})`;
}

const CSS_FONTS: Record<DesignFont, string> = {
  classica: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
  moderna: '"Avenir Next",Avenir,"Segoe UI","Noto Sans",sans-serif',
  maquina: '"Courier New",Courier,monospace',
};

export function themeCss(design: Design, slug: string, version: string): string {
  const image = design.backgroundImage
    ? `.t-image{background-image:linear-gradient(var(--t-overlay),var(--t-overlay)),url("/e/${slug}/media/background?v=${version}");background-size:cover;background-position:center}`
    : "";
  return (
    `:root{--t-bg:${design.backgroundColor};--t-text:${design.textColor};--t-accent:${design.accentColor};` +
    `--t-overlay:${rgba(design.backgroundColor, design.overlay)};--t-font:${CSS_FONTS[design.font]}}${image}`
  );
}
