import { connect as netConnect, isIP, type Socket } from "node:net";
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from "node:tls";
import { decryptSecret } from "./secret";
import type { EmailSettings } from "./settings";

const TIMEOUT_MS = 20_000;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string): string {
  const clean = singleLine(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function buildMessage(settings: EmailSettings, message: MailMessage): string {
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const headers = [
    `From: ${encodedHeader(settings.fromName)} <${singleLine(settings.fromAddress)}>`,
    `To: <${singleLine(message.to)}>`,
    `Subject: ${encodedHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

class SmtpClient {
  private buffer = "";
  private waiting?: { resolve: (reply: string) => void; reject: (error: Error) => void };
  private failure?: Error;

  constructor(private socket: Socket) {
    this.attach(socket);
  }

  private attach(socket: Socket): void {
    socket.setEncoding("utf8");
    socket.on("data", this.onData);
    socket.on("error", this.onFailure);
    socket.on("close", this.onClose);
  }

  private detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onFailure);
    this.socket.off("close", this.onClose);
  }

  private onData = (chunk: string | Buffer) => {
    this.buffer += chunk.toString();
    this.flush();
  };

  private onFailure = (error: Error) => {
    this.failure = error;
    this.waiting?.reject(error);
    this.waiting = undefined;
  };

  private onClose = () => this.onFailure(new Error("A ligação ao servidor de e-mail foi fechada."));

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    const end = lines.findIndex((line) => /^\d{3} /.test(line) || /^\d{3}$/.test(line));
    if (end < 0) return;
    const reply = lines.slice(0, end + 1).join("\n");
    this.buffer = lines.slice(end + 1).join("\r\n");
    const { resolve } = this.waiting;
    this.waiting = undefined;
    resolve(reply);
  }

  read(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.flush();
    });
  }

  async expect(code: number): Promise<string> {
    const reply = await this.read();
    if (!reply.startsWith(String(code))) throw new Error(`O servidor de e-mail respondeu: ${reply.split("\n").pop()}`);
    return reply;
  }

  async command(line: string, code: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.expect(code);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  async startTls(options: ConnectionOptions): Promise<void> {
    this.detach();
    const secure = await secureSocket({ ...options, socket: this.socket });
    this.socket = secure;
    this.buffer = "";
    this.attach(secure);
  }

  close(): void {
    this.detach();
    this.socket.on("error", () => {});
    this.socket.destroy();
  }
}

function secureSocket(options: ConnectionOptions): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(options, () => resolve(socket));
    socket.once("error", reject);
  });
}

function plainSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function deliver(settings: EmailSettings, message: MailMessage, tlsOptions: ConnectionOptions): Promise<void> {
  const { host, port, security, username, passwordEncrypted, fromAddress } = settings;
  const tls = isIP(host) ? tlsOptions : { servername: host, ...tlsOptions };
  const socket = security === "tls" ? await secureSocket({ host, port, ...tls }) : await plainSocket(host, port);
  const client = new SmtpClient(socket);
  try {
    await client.expect(220);
    let hello = await client.command("EHLO wedding4ever", 250);
    if (security === "starttls") {
      if (!/\bSTARTTLS\b/i.test(hello)) throw new Error("O servidor de e-mail não oferece STARTTLS.");
      await client.command("STARTTLS", 220);
      await client.startTls(tls);
      hello = await client.command("EHLO wedding4ever", 250);
    }
    if (username) {
      const password = passwordEncrypted ? decryptSecret(passwordEncrypted) : "";
      const credentials = Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64");
      await client.command(`AUTH PLAIN ${credentials}`, 235);
    }
    await client.command(`MAIL FROM:<${singleLine(fromAddress)}>`, 250);
    await client.command(`RCPT TO:<${singleLine(message.to)}>`, 250);
    await client.command("DATA", 354);
    client.write(`${buildMessage(settings, message)}\r\n.\r\n`);
    await client.expect(250);
    await client.command("QUIT", 221).catch(() => {});
  } finally {
    client.close();
  }
}

export async function sendMail(settings: EmailSettings, message: MailMessage, tlsOptions: ConnectionOptions = {}): Promise<void> {
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("O servidor de e-mail demorou demasiado a responder.")), TIMEOUT_MS);
  });
  try {
    await Promise.race([deliver(settings, message, tlsOptions), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
