import { deflateSync, inflateSync } from "node:zlib";
import type { ImageExtension } from "./design";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

export interface PdfImage {
  width: number;
  height: number;
  colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  filter: "DCTDecode" | "FlateDecode";
  data: Uint8Array;
  alpha?: Uint8Array;
  invert?: boolean;
}

export function imageExtensionOf(bytes: Uint8Array): ImageExtension | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return "png";
  return undefined;
}

function parseJpeg(bytes: Uint8Array): PdfImage {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG inválido");
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      const components = bytes[offset + 9]!;
      const colorSpace = components === 1 ? "DeviceGray" : components === 3 ? "DeviceRGB" : components === 4 ? "DeviceCMYK" : undefined;
      if (!colorSpace || !width || !height) throw new Error("JPEG não suportado");
      return { width, height, colorSpace, filter: "DCTDecode", data: bytes, invert: components === 4 };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG inválido");
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function parsePng(bytes: Uint8Array): PdfImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      colorType = chunk[9]!;
      if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error("PNG não suportado");
    } else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
    offset += 12 + length;
  }

  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || !width || !height || width * height > MAX_PIXELS || (colorType === 3 && !palette)) {
    throw new Error("PNG não suportado");
  }
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (raw.length < (stride + 1) * height) throw new Error("PNG incompleto");

  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height).fill(255);
  let hasAlpha = false;
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let i = 0; i < stride; i++) {
      const value = raw[rowStart + 1 + i]!;
      const left = i >= channels ? current[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const prediction =
        filter === 0 ? 0
        : filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? (left + up) >> 1
        : filter === 4 ? paeth(left, up, upLeft)
        : -1;
      if (prediction < 0) throw new Error("PNG inválido");
      current[i] = (value + prediction) & 255;
    }
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const source = x * channels;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 3) {
        const index = current[source]!;
        r = palette![index * 3] ?? 0;
        g = palette![index * 3 + 1] ?? 0;
        b = palette![index * 3 + 2] ?? 0;
        a = transparency?.[index] ?? 255;
      } else if (colorType === 2 || colorType === 6) {
        r = current[source]!;
        g = current[source + 1]!;
        b = current[source + 2]!;
        if (colorType === 6) a = current[source + 3]!;
      } else {
        r = g = b = current[source]!;
        if (colorType === 4) a = current[source + 1]!;
      }
      rgb.set([r, g, b], pixel * 3);
      alpha[pixel] = a;
      if (a !== 255) hasAlpha = true;
    }
    [previous, current] = [current, previous];
  }

  return {
    width,
    height,
    colorSpace: "DeviceRGB",
    filter: "FlateDecode",
    data: deflateSync(rgb),
    alpha: hasAlpha ? deflateSync(alpha) : undefined,
  };
}

/** Lê a imagem e devolve-a pronta para o PDF; imagens que o PDF não aceita são recusadas. */
export function toPdfImage(bytes: Uint8Array): PdfImage {
  const extension = imageExtensionOf(bytes);
  if (!extension) throw new Error("Formato não suportado");
  const image = extension === "jpg" ? parseJpeg(bytes) : parsePng(bytes);
  if (image.width * image.height > MAX_PIXELS) throw new Error("Imagem demasiado grande");
  return image;
}
