import { central } from "../db/central";

export const AUDIENCES = ["cliente", "organizador", "superadmin"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface EmailTemplate {
  subject: string;
  body: string;
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  cliente: "Cliente",
  organizador: "Organizador",
  superadmin: "Superadmin",
};

export const EMAIL_VARIABLES: Record<string, string> = {
  evento: "Nome do evento",
  tipo: "Tipo de evento",
  data: "Data do evento",
  local: "Local",
  pack: "Pack contratado",
  limite: "Limite de convidados",
  link: "Link dos convidados",
  area_cliente: "Endereço da área de cliente",
  email_cliente: "E-mail do cliente",
  codigo: "Código de acesso do cliente",
  organizador: "Nome do organizador",
  dias: "Dias disponíveis após o evento",
  data_limite: "Último dia disponível",
  plataforma: "Nome da plataforma",
};

export const DEFAULT_TEMPLATES: Record<Audience, EmailTemplate> = {
  cliente: {
    subject: "O teu evento {{evento}} está criado",
    body: `Olá,

Obrigado por escolheres a {{plataforma}} para o teu evento. O {{evento}} já está criado e pronto a preparar.

Dados do evento
Data: {{data}}
Tipo: {{tipo}}
Pack: {{pack}}

Como aceder à tua área
Endereço: {{area_cliente}}
E-mail: {{email_cliente}}
Código de acesso: {{codigo}}

Como vai funcionar
1. Na tua área encontras o QR Code e os cartões prontos a imprimir ou a personalizar.
2. Coloca os cartões nas mesas ou partilha o QR Code com os convidados.
3. Cada convidado lê o código com o telemóvel e entra com o nome e o e-mail. Não precisa de instalar nada.
4. Os convidados aguardam até o gestor do evento disponibilizar as missões.
5. Quando as missões abrirem, cada convidado envia as suas fotografias.
6. Na hora escolhida, o gestor abre a votação e todos escolhem as favoritas.
7. No fim, as mais votadas são reveladas e há um vencedor por missão.

Muito importante
Todas as fotografias ficam disponíveis durante {{dias}} dias após o evento, até {{data_limite}}. Depois dessa data serão eliminadas e não ficam guardadas na plataforma. Não te esqueças de as descarregar e guardar em segurança.

Obrigado pela tua escolha e boa festa.
A equipa {{plataforma}}`,
  },
  organizador: {
    subject: "Novo evento criado: {{evento}}",
    body: `Olá {{organizador}},

O evento {{evento}} foi criado.

Data: {{data}}
Tipo: {{tipo}}
Cliente: {{email_cliente}}
Pack: {{pack}}
Link dos convidados: {{link}}

As fotografias ficam disponíveis até {{data_limite}}.

A equipa {{plataforma}}`,
  },
  superadmin: {
    subject: "Novo evento: {{evento}}",
    body: `Foi criado um novo evento.

Evento: {{evento}}
Tipo: {{tipo}}
Data: {{data}}
Cliente: {{email_cliente}}
Organizador: {{organizador}}
Pack: {{pack}}
Limite de convidados: {{limite}}
Último dia disponível: {{data_limite}}`,
  },
};

export async function getTemplates(): Promise<Record<Audience, EmailTemplate>> {
  const rows: { value: Partial<Record<Audience, EmailTemplate>> }[] = await central`SELECT value FROM settings WHERE key = 'email_templates'`;
  return { ...DEFAULT_TEMPLATES, ...rows[0]?.value };
}

export async function saveTemplate(audience: Audience, template: EmailTemplate): Promise<void> {
  const templates = { ...(await getTemplates()), [audience]: template };
  const value = JSON.stringify(templates);
  await central`
    INSERT INTO settings (key, value) VALUES ('email_templates', ${value}::text::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}
