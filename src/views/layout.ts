import { html, type Html } from "../lib/html";

export const rings = html`<svg class="rings" viewBox="0 0 44 28" aria-hidden="true"><circle cx="15" cy="14" r="11"/><circle cx="29" cy="14" r="11"/></svg>`;

export function page(title: string, body: Html, className = "", stylesheet?: string): string {
  return `<!doctype html>${html`
<html lang="pt-PT">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/static/style.css">
  ${stylesheet && html`<link rel="stylesheet" href="${stylesheet}">`}
</head>
<body class="${className}">${body}</body>
</html>`}`;
}
