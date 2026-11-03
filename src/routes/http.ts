import { notFoundPage } from "../views/public";

export function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

export function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

export function notFound(): Response {
  return htmlResponse(notFoundPage(), 404);
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function isEmail(value: string): boolean {
  return value.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
