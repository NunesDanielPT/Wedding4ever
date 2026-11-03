const dateFormat = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" });

export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

export function coupleNames(one: string, two: string): string {
  return `${one} & ${two}`;
}

export function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "";
}
