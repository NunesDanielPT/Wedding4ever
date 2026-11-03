import { deflateSync } from "node:zlib";
import type { QrCode } from "./qr";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32Update(start: number, bytes: Uint8Array): number {
  let crc = start;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return crc;
}

function crc32(bytes: Uint8Array): number {
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function qrPng(qr: QrCode, foreground: string, background: string, moduleSize = 16, quiet = 4): Uint8Array {
  const total = (qr.size + quiet * 2) * moduleSize;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, total);
  view.setUint32(4, total);
  header.set([8, 2, 0, 0, 0], 8);

  const stride = total * 3 + 1;
  const pixels = new Uint8Array(stride * total);
  const dark = rgb(foreground);
  const light = rgb(background);
  for (let y = 0; y < total; y++) {
    const row = y * stride + 1;
    const moduleY = Math.floor(y / moduleSize) - quiet;
    for (let x = 0; x < total; x++) {
      const moduleX = Math.floor(x / moduleSize) - quiet;
      pixels.set(qr.modules[moduleY]?.[moduleX] ? dark : light, row + x * 3);
    }
  }

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}
