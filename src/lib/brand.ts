export const DEFAULT_BRAND = "AllForPic";

let current = DEFAULT_BRAND;

export function brand(): string {
  return current;
}

export function setBrand(name: string): void {
  current = name.trim() || DEFAULT_BRAND;
}
