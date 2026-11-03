/**
 * Gerador de QR Code (modo byte, correção M, versões 1 a 10).
 * Chega para links até 213 bytes, sem depender de pacotes externos.
 */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCK_COUNT = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_ECC_M = 0;

export interface QrCode {
  size: number;
  modules: boolean[][];
}

function rawModules(version: number): number {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    bits -= (25 * align - 10) * align - 55;
    if (version >= 7) bits -= 36;
  }
  return bits;
}

function dataCapacity(version: number): number {
  const i = version - 1;
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[i]! * BLOCK_COUNT[i]!;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = result[i]! ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));

  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const codewords = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => {
    codewords[i >>> 3] = codewords[i >>> 3]! | (bit << (7 - (i & 7)));
  });
  return codewords;
}

function addErrorCorrection(data: number[], version: number): number[] {
  const i = version - 1;
  const blockCount = BLOCK_COUNT[i]!;
  const eccLength = ECC_PER_BLOCK[i]!;
  const total = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount);
  const divisor = rsDivisor(eccLength);

  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (let block = 0; block < blockCount; block++) {
    const length = shortLength - eccLength + (block < shortBlocks ? 0 : 1);
    const chunk = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(chunk);
    eccBlocks.push(rsRemainder(chunk, divisor));
  }

  const result: number[] = [];
  for (let column = 0; column <= shortLength - eccLength; column++) {
    for (const block of dataBlocks) if (column < block.length) result.push(block[column]!);
  }
  for (let column = 0; column < eccLength; column++) {
    for (const block of eccBlocks) result.push(block[column]!);
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let pos = version * 4 + 10; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.reserved[y]![x] = true;
  }

  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  private drawFunctionPatterns(): void {
    const { size, version } = this;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(size - 4, 3);
    this.finder(3, size - 4);

    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((py, i) => {
      positions.forEach((px, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });

    this.drawFormat(0);
    if (version >= 7) {
      let remainder = version;
      for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
      const bits = (version << 12) | remainder;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }

  drawFormat(mask: number): void {
    const { size } = this;
    const data = (FORMAT_ECC_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  drawCodewords(codewords: number[]): void {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (this.reserved[y]![x] || i >= codewords.length * 8) continue;
          this.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.reserved[y]![x] && maskBit(mask, x, y)) this.dark[y]![x] = !this.dark[y]![x];
      }
    }
  }

  penalty(): number {
    const { size, dark } = this;
    let score = 0;
    const lines = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < size; a++) {
        let run = 0;
        let colour = false;
        let pattern = 0;
        for (let b = 0; b < size; b++) {
          const module = get(a, b);
          if (b > 0 && module === colour) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else {
            colour = module;
            run = 1;
          }
          pattern = ((pattern << 1) & 0x7ff) | (module ? 1 : 0);
          if (b >= 10 && (pattern === 0x5d || pattern === 0x5d0)) score += 40;
        }
      }
    };
    lines((a, b) => dark[a]![b]!);
    lines((a, b) => dark[b]![a]!);

    let darkCount = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (dark[y]![x]) darkCount++;
        if (x + 1 < size && y + 1 < size) {
          const c = dark[y]![x];
          if (c === dark[y]![x + 1] && c === dark[y + 1]![x] && c === dark[y + 1]![x + 1]) score += 3;
        }
      }
    }
    const percent = (darkCount * 100) / (size * size);
    return score + Math.floor(Math.abs(percent - 50) / 5) * 10;
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

export function createQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10) {
    const header = 4 + (version <= 9 ? 8 : 16);
    if (header + bytes.length * 8 <= dataCapacity(version) * 8) break;
    version++;
  }
  if (version > 10) throw new Error("Link demasiado longo para o QR Code");

  const codewords = addErrorCorrection(encodeData(bytes, version), version);
  const matrix = new Matrix(version);
  matrix.drawCodewords(codewords);

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    matrix.applyMask(mask);
    matrix.drawFormat(mask);
    const score = matrix.penalty();
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    matrix.applyMask(mask);
  }
  matrix.applyMask(bestMask);
  matrix.drawFormat(bestMask);
  return { size: matrix.size, modules: matrix.dark };
}

export function qrSvg(qr: QrCode, { foreground = "#1F3350", background = "#FFFFFF", quiet = 4 } = {}): string {
  const total = qr.size + quiet * 2;
  let path = "";
  qr.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${background}"/><path d="${path}" fill="${foreground}"/></svg>`
  );
}
