export const DEFAULT_BRAND = "Batalha da Melhor Foto";

let current = DEFAULT_BRAND;

export function brand(): string {
  return current;
}

export function setBrand(name: string): void {
  current = name.trim() || DEFAULT_BRAND;
}
