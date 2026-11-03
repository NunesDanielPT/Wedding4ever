const dateFormat = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" });

export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Iniciais das duas primeiras palavras com significado do nome do evento. */
export function initials(name: string): string {
  const skip = new Set(["de", "da", "do", "das", "dos", "e", "o", "a"]);
  const words = name.trim().split(/\s+/).filter((word) => !skip.has(word.toLowerCase()));
  return words.slice(0, 2).map((word) => [...word][0]?.toUpperCase() ?? "").join("");
}
