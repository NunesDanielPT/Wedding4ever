import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import { config } from "../config";
import { central } from "../db/central";
import { decryptSecret, encryptSecret } from "./secret";

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface PushRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

const ALLOWED_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const RECORD_SIZE = 4096;
const TTL_SECONDS = 3600;

const b64 = (value: Uint8Array | Buffer) => Buffer.from(value).toString("base64url");

/** Só aceita servidores de notificações conhecidos, porque o endereço vem do telemóvel. */
export function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && ALLOWED_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

let cached: VapidKeys | undefined;

export async function getVapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;
  const rows: { value: { publicKey: string; privateEncrypted: string } }[] = await central`SELECT value FROM settings WHERE key = 'vapid'`;
  const stored = rows[0]?.value;
  if (stored) {
    cached = { publicKey: stored.publicKey, privateJwk: JSON.parse(decryptSecret(stored.privateEncrypted)) };
    return cached;
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  const value = JSON.stringify({ publicKey: b64(raw), privateEncrypted: encryptSecret(JSON.stringify(jwk)) });
  await central`
    INSERT INTO settings (key, value) VALUES ('vapid', ${value}::text::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
  return getVapidAfterInsert();
}

async function getVapidAfterInsert(): Promise<VapidKeys> {
  cached = undefined;
  return getVapidKeys();
}

function vapidToken(endpoint: string, keys: VapidKeys): string {
  const subject = config.publicUrl.startsWith("https://") ? config.publicUrl : `mailto:${config.adminEmail || "admin@example.com"}`;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const key = createPrivateKey({ key: keys.privateJwk as never, format: "jwk" });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${b64(signature)}`;
}

/** Encripta a mensagem para este telemóvel, conforme o RFC 8291. */
export function encryptPayload(subscription: PushSubscription, payload: string): Uint8Array {
  const clientPublic = Buffer.from(subscription.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.auth, "base64url");
  const server = createECDH("prime256v1");
  const serverPublic = server.generateKeys();
  const shared = server.computeSecret(clientPublic);
  const salt = randomBytes(16);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = serverPublic.length;
  return Buffer.concat([header, serverPublic, body]);
}

export function buildPushRequest(subscription: PushSubscription, payload: string, keys: VapidKeys): PushRequest {
  return {
    url: subscription.endpoint,
    headers: {
      Authorization: `vapid t=${vapidToken(subscription.endpoint, keys)}, k=${keys.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(TTL_SECONDS),
      Urgency: "high",
    },
    body: encryptPayload(subscription, payload),
  };
}

/** Devolve falso quando o telemóvel cancelou a subscrição e ela deve ser apagada. */
export async function sendPush(subscription: PushSubscription, payload: string, keys: VapidKeys): Promise<boolean> {
  const request = buildPushRequest(subscription, payload, keys);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) throw new Error(`Serviço de notificações respondeu ${response.status}`);
  return true;
}
