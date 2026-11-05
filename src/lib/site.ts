import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { central } from "../db/central";

export type FieldType = "text" | "textarea" | "url" | "image" | "checkbox" | "number";

export interface SiteField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
}

export type SiteItem = { id: string } & Record<string, string>;

export const TEXT_FIELDS: SiteField[] = [
  { name: "heroTitle", label: "Título principal", type: "text", required: true },
  { name: "heroSubtitle", label: "Texto de apresentação", type: "textarea", required: true },
  { name: "heroButton", label: "Botão principal", type: "text", required: true },
  { name: "heroImage", label: "Imagem principal, substitui a ilustração", type: "image" },
  { name: "aboutTitle", label: "Título de “O que é”", type: "text", required: true },
  { name: "aboutText", label: "Texto de “O que é”", type: "textarea", required: true },
  { name: "stepsTitle", label: "Título de “Como funciona”", type: "text", required: true },
  { name: "galleryTitle", label: "Título das imagens", type: "text", required: true },
  { name: "testimonialsTitle", label: "Título dos testemunhos", type: "text", required: true },
  { name: "adsTitle", label: "Título da publicidade", type: "text", required: true },
  { name: "packsTitle", label: "Título dos packs", type: "text", required: true },
  { name: "packsNote", label: "Nota dos packs", type: "textarea" },
  { name: "supportTitle", label: "Título do suporte", type: "text", required: true },
  { name: "supportText", label: "Texto do suporte", type: "textarea", required: true },
  { name: "footerText", label: "Texto do rodapé", type: "text" },
];

export const SITE_COLLECTIONS: Record<string, { title: string; add: string; fields: SiteField[] }> = {
  steps: {
    title: "Como funciona",
    add: "Adicionar passo",
    fields: [
      { name: "title", label: "Título", type: "text", required: true },
      { name: "text", label: "Texto", type: "textarea", required: true },
    ],
  },
  gallery: {
    title: "Imagens",
    add: "Adicionar imagem",
    fields: [
      { name: "image", label: "Imagem", type: "image", required: true },
      { name: "caption", label: "Legenda", type: "text" },
    ],
  },
  testimonials: {
    title: "Testemunhos",
    add: "Adicionar testemunho",
    fields: [
      { name: "text", label: "Testemunho", type: "textarea", required: true },
      { name: "author", label: "Nome", type: "text", required: true },
      { name: "role", label: "Evento ou função", type: "text" },
      { name: "image", label: "Fotografia, com autorização da pessoa", type: "image" },
    ],
  },
  ads: {
    title: "Publicidade",
    add: "Adicionar publicidade",
    fields: [
      { name: "title", label: "Título", type: "text", required: true },
      { name: "text", label: "Texto", type: "textarea" },
      { name: "image", label: "Imagem", type: "image" },
      { name: "url", label: "Link", type: "url", hint: "Começa por https://" },
    ],
  },
  packs: {
    title: "Packs",
    add: "Adicionar pack",
    fields: [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "guests", label: "Texto dos convidados", type: "text", required: true },
      { name: "maxGuests", label: "Máximo de convidados", type: "number", hint: "Em branco fica sem limite" },
      { name: "price", label: "Preço", type: "text", hint: "Em branco aparece “Sob consulta”" },
      { name: "features", label: "O que inclui, uma linha por item", type: "textarea", required: true },
      { name: "highlight", label: "Destacar este pack", type: "checkbox" },
    ],
  },
};

const PACK_FEATURES = [
  "QR Code e cartões de mesa personalizados",
  "Missões fotográficas à medida",
  "Votação por missão durante a festa",
  "Apresentação dos vencedores",
  "Download do álbum em ZIP",
].join("\n");

const pack = (id: string, name: string, guests: string, maxGuests: string, price: string): SiteItem => ({
  id, name, guests, maxGuests, price, features: PACK_FEATURES, highlight: "",
});

export interface Site {
  texts: Record<string, string>;
  steps: SiteItem[];
  gallery: SiteItem[];
  testimonials: SiteItem[];
  ads: SiteItem[];
  packs: SiteItem[];
}

const DEFAULT_SITE: Site = {
  texts: {
    heroTitle: "A melhor foto do evento pode vir de quem menos espera",
    heroSubtitle: "Em casamentos, batizados, aniversários ou qualquer festa, os convidados leem o QR Code da mesa, cumprem missões fotográficas e votam nas melhores capturas da noite, sem instalar aplicações.",
    heroButton: "Ver packs",
    heroImage: "",
    aboutTitle: "Uma batalha de fotografias entre os vossos convidados",
    aboutText: "Cada convidado torna-se um fotógrafo em missão. Enquanto o evento acontece, ficam guardados os momentos que o fotógrafo oficial não consegue ver, e no fim há vencedores para celebrar.",
    stepsTitle: "Como funciona",
    galleryTitle: "Momentos da festa",
    testimonialsTitle: "O que dizem os nossos clientes",
    adsTitle: "Parceiros",
    packsTitle: "Packs",
    packsNote: "O pack é escolhido pelo número de convidados do evento.",
    supportTitle: "Fala connosco",
    supportText: "Tens uma dúvida ou queres reservar a tua data? Envia-nos uma mensagem.",
    footerText: "Fotografias, missões e votos para qualquer evento",
  },
  steps: [
    { id: "s1", title: "Cartões nas mesas", text: "Cada evento tem o seu link, o seu QR Code e cartões com a sua identidade." },
    { id: "s2", title: "Missões fotográficas", text: "Os convidados entram pelo telemóvel e escolhem as missões preparadas para aquele evento." },
    { id: "s3", title: "Votação na festa", text: "A organização abre a votação de cada missão quando quiser, mesmo a meio da festa." },
    { id: "s4", title: "Vencedores e álbum", text: "As melhores fotografias são reveladas e todas as imagens ficam disponíveis para download." },
  ],
  gallery: [],
  testimonials: [],
  ads: [],
  packs: [
    pack("p1", "Essencial", "Até 100 convidados", "100", "59 €"),
    pack("p2", "Clássico", "Até 150 convidados", "150", "89 €"),
    pack("p3", "Grande festa", "Até 200 convidados", "200", "119 €"),
    pack("p4", "Sem limites", "300 ou mais convidados", "", "169 €"),
  ],
};

/** Textos da versão só para casamentos, substituídos se nunca foram editados. */
const WEDDING_TEXTS: Record<string, string> = {
  heroTitle: "A melhor foto do casamento pode vir de quem menos espera",
  heroSubtitle: "Os convidados leem o QR Code da mesa, cumprem missões fotográficas e votam nas melhores capturas da noite, sem instalar aplicações.",
  aboutText: "O Wedding4Ever transforma cada convidado num fotógrafo em missão. Enquanto a festa acontece, ficam guardados os momentos que o fotógrafo oficial não consegue ver, e no fim há vencedores para celebrar.",
  testimonialsTitle: "O que dizem os noivos",
  footerText: "Wedding4Ever, Batalha da Melhor Foto",
};
const WEDDING_STEPS: Record<string, string> = {
  s1: "Cada evento tem o seu link, o seu QR Code e cartões com a identidade dos noivos.",
  s2: "Os convidados entram pelo telemóvel e escolhem missões como um brinde ou a pista de dança.",
  s3: "Os noivos abrem a votação de cada missão quando quiserem, mesmo a meio do jantar.",
};

export async function getSite(): Promise<Site> {
  const rows: { value: Partial<Site> }[] = await central`SELECT value FROM settings WHERE key = 'site'`;
  const stored = rows[0]?.value ?? {};
  const texts = { ...DEFAULT_SITE.texts, ...stored.texts };
  for (const [key, value] of Object.entries(WEDDING_TEXTS)) {
    if (texts[key] === value) texts[key] = DEFAULT_SITE.texts[key]!;
  }
  const site = { ...DEFAULT_SITE, ...stored, texts };
  site.steps = site.steps.map((step) =>
    step.text === WEDDING_STEPS[step.id]
      ? { ...step, text: DEFAULT_SITE.steps.find((base) => base.id === step.id)!.text }
      : step,
  );
  const packs = site.packs.map((item) => ({
    ...item,
    maxGuests: item.maxGuests ?? DEFAULT_SITE.packs.find((base) => base.id === item.id)?.maxGuests ?? "",
    price: item.price || (DEFAULT_SITE.packs.find((base) => base.id === item.id)?.price ?? ""),
  }));
  return { ...site, packs };
}

export async function saveSite(site: Site): Promise<void> {
  const value = JSON.stringify(site);
  await central`
    INSERT INTO settings (key, value) VALUES ('site', ${value}::text::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

function siteDir(): string {
  return join(config.storageDir, "site");
}

export function siteMediaPath(file: string): string {
  return join(siteDir(), file);
}

export async function saveSiteImage(bytes: Uint8Array, extension: string): Promise<string> {
  await mkdir(siteDir(), { recursive: true });
  const file = `${randomUUID()}.${extension}`;
  await Bun.write(siteMediaPath(file), bytes);
  return file;
}

export async function removeSiteImage(file: string | undefined): Promise<void> {
  if (file && /^[0-9a-f-]{36}\.(jpg|png)$/.test(file)) await rm(siteMediaPath(file), { force: true });
}

export interface SupportMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  read_at: Date | null;
  created_at: Date;
}

export async function addSupportMessage(name: string, email: string, message: string): Promise<void> {
  await central`INSERT INTO support_messages (name, email, message) VALUES (${name}, ${email}, ${message})`;
}

export async function listSupportMessages(): Promise<SupportMessage[]> {
  return central`SELECT id, name, email, message, read_at, created_at FROM support_messages ORDER BY created_at DESC`;
}

export async function countUnreadMessages(): Promise<number> {
  const [row]: { count: number }[] = await central`SELECT count(*)::int AS count FROM support_messages WHERE read_at IS NULL`;
  return row!.count;
}

export async function setMessageRead(id: string, read: boolean): Promise<void> {
  await central`UPDATE support_messages SET read_at = ${read ? new Date() : null} WHERE id = ${id}::uuid`;
}

export async function deleteMessage(id: string): Promise<void> {
  await central`DELETE FROM support_messages WHERE id = ${id}::uuid`;
}
