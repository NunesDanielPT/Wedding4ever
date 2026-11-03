export type ImageExtension = "jpg" | "png";

export interface Design {
  headline: string;
  instructions: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  qrColor: string;
  qrBackground: string;
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
};

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
  if (COLOR_FIELDS.some((field) => !HEX.test(design[field]))) return "Escolhe cores válidas.";
  if (luminance(design.qrColor) >= luminance(design.qrBackground)) {
    return "O QR Code tem de ser mais escuro do que o fundo, para os telemóveis o conseguirem ler.";
  }
  if (contrastRatio(design.qrColor, design.qrBackground) < 4) {
    return "Aumenta o contraste entre o QR Code e o fundo, para os telemóveis o conseguirem ler.";
  }
  return undefined;
}

export function themeCss(design: Design, slug: string): string {
  const image = design.backgroundImage
    ? `.t-image{background-image:url("/e/${slug}/media/background");background-size:cover;background-position:center}`
    : "";
  return `:root{--t-bg:${design.backgroundColor};--t-text:${design.textColor};--t-accent:${design.accentColor}}${image}`;
}
