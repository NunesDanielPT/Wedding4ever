import { central } from "../db/central";
import { encryptSecret } from "./secret";

export type SmtpSecurity = "starttls" | "tls";

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  passwordEncrypted: string;
  fromName: string;
  fromAddress: string;
}

export interface PlatformSettings {
  defaultPhotoLimit: number;
  email: EmailSettings;
}

export const MIN_PHOTO_LIMIT = 1;
export const MAX_PHOTO_LIMIT = 50;

const DEFAULTS: PlatformSettings = {
  defaultPhotoLimit: 3,
  email: {
    enabled: false,
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    passwordEncrypted: "",
    fromName: "Wedding4Ever",
    fromAddress: "",
  },
};

export function parsePhotoLimit(value: string): number | undefined {
  if (!/^\d{1,2}$/.test(value)) return undefined;
  const limit = Number(value);
  return limit >= MIN_PHOTO_LIMIT && limit <= MAX_PHOTO_LIMIT ? limit : undefined;
}

export async function getSettings(): Promise<PlatformSettings> {
  const rows: { value: Partial<PlatformSettings> }[] = await central`SELECT value FROM settings WHERE key = 'platform'`;
  const stored = rows[0]?.value ?? {};
  return { ...DEFAULTS, ...stored, email: { ...DEFAULTS.email, ...stored.email } };
}

async function saveSettings(settings: PlatformSettings): Promise<void> {
  const value = JSON.stringify(settings);
  await central`
    INSERT INTO settings (key, value) VALUES ('platform', ${value}::text::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function saveDefaultPhotoLimit(limit: number): Promise<void> {
  await saveSettings({ ...(await getSettings()), defaultPhotoLimit: limit });
}

export interface EmailInput extends Omit<EmailSettings, "passwordEncrypted"> {
  password: string;
}

/** Com a palavra-passe em branco, mantém a que já estava guardada. */
export async function saveEmailSettings(input: EmailInput): Promise<void> {
  const settings = await getSettings();
  const { password, ...email } = input;
  await saveSettings({
    ...settings,
    email: {
      ...email,
      passwordEncrypted: password ? encryptSecret(password) : settings.email.passwordEncrypted,
    },
  });
}
