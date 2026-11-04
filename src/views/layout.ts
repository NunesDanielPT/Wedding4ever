import { asset } from "../lib/assets";
import { html, type Html } from "../lib/html";

export const rings = html`<svg class="rings" width="30" height="30" fill="#1f3350" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="17"/><path d="M22 11l3.3 7 7.7 1-5.6 5.3 1.4 7.6-6.8-3.9-6.8 3.9 1.4-7.6L11 19l7.7-1z"/></svg>`;

export function page(title: string, body: Html, className = "", stylesheet?: string, description?: string, head?: Html): string {
  return `<!doctype html>${html`
<html lang="pt-PT">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${description ? html`<meta name="description" content="${description}">` : html`<meta name="robots" content="noindex">`}
  <title>${title}</title>
  <link rel="icon" href="${asset("favicon.svg")}" type="image/svg+xml">
  <link rel="stylesheet" href="${asset("style.css")}">
  ${stylesheet && html`<link rel="stylesheet" href="${stylesheet}">`}
  ${head}
</head>
<body class="${className}">${body}</body>
</html>`}`;
}
