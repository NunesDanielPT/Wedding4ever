export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** Tudo o que é interpolado é escapado, exceto fragmentos criados por esta função. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  return new Html(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ""), ""));
}
