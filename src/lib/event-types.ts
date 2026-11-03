export const EVENT_TYPE_IDS = ["casamento", "batizado", "aniversario", "evento"] as const;
export type EventType = (typeof EVENT_TYPE_IDS)[number];

interface EventTypeInfo {
  label: string;
  namePlaceholder: string;
  missions: string[];
  suggestions: string[];
}

export const EVENT_TYPES: Record<EventType, EventTypeInfo> = {
  casamento: {
    label: "Casamento",
    namePlaceholder: "Casamento Ana e Pedro, Quinta do Lago",
    missions: [
      "Foto com todos da sua mesa",
      "Beijo dos noivos",
      "Um brinde com os noivos",
      "Na pista de dança",
      "Selfie com alguém de quem gostes",
      "Um pai a enxugar uma lágrima",
      "A aliança mostrada com orgulho",
    ],
    suggestions: [
      "A melhor gargalhada da noite",
      "O passo de dança mais improvável",
      "Selfie com a pessoa que veio de mais longe",
      "Três gerações na mesma fotografia",
      "Os sapatos que mais sofreram na pista",
      "O melhor penteado no fim da noite",
      "A mesa mais animada",
      "A fotografia mais criativa com o bolo",
      "Alguém a chorar de felicidade",
      "O momento mais romântico dos noivos",
      "Uma foto com alguém que acabaste de conhecer",
    ],
  },
  batizado: {
    label: "Batizado",
    namePlaceholder: "Batizado do Tomás, 12 de junho",
    missions: [
      "O sorriso do bebé",
      "Os padrinhos com o bebé",
      "A família reunida",
      "O momento da água benta",
      "A vela acesa",
      "Foto com todos da sua mesa",
      "Um abraço aos pais",
    ],
    suggestions: [
      "As mãos pequeninas",
      "Três gerações na mesma fotografia",
      "O bolo antes de ser cortado",
      "O bebé a dormir no colo",
      "Um brinde à família",
      "A criança mais divertida da festa",
      "A roupa do batizado em pormenor",
      "A avó mais orgulhosa",
      "Selfie com os padrinhos",
    ],
  },
  aniversario: {
    label: "Festa de aniversário",
    namePlaceholder: "Aniversário da Rita, 40 anos",
    missions: [
      "O momento de apagar as velas",
      "Selfie com quem faz anos",
      "Foto de grupo na festa",
      "O bolo antes do primeiro corte",
      "Na pista de dança",
      "O melhor presente da noite",
      "A cara mais divertida",
    ],
    suggestions: [
      "O abraço mais apertado",
      "A pose mais improvável",
      "O melhor brinde",
      "A gargalhada mais contagiante",
      "A foto mais antiga recriada",
      "Quem veio de mais longe",
      "O passo de dança mais louco",
      "A melhor roupa da festa",
      "Uma foto com alguém que acabaste de conhecer",
    ],
  },
  evento: {
    label: "Outro evento",
    namePlaceholder: "Jantar de Natal da empresa 2027",
    missions: [
      "A melhor foto de grupo",
      "A selfie mais divertida",
      "O momento mais inesperado",
      "O melhor pormenor do espaço",
      "Um brinde com a tua mesa",
    ],
    suggestions: [
      "A equipa mais animada",
      "A melhor gargalhada",
      "O discurso em imagem",
      "A pose mais criativa",
      "Uma foto com alguém que acabaste de conhecer",
      "O momento dos bastidores",
      "O pormenor que ninguém reparou",
      "A melhor mesa",
    ],
  },
};

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPE_IDS as readonly string[]).includes(value);
}
