import { crc32Update } from "./png";

export interface ZipEntry {
  name: string;
  path: string;
}

const encoder = new TextEncoder();
const FLAGS = 0x0808; // tamanhos no fim de cada ficheiro e nomes em UTF-8
const VERSION = 45;

function bytes(size: number, write: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(size);
  write(new DataView(out.buffer));
  return out;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function* archive(entries: ZipEntry[], zip64Threshold: number): AsyncGenerator<Uint8Array> {
  const { time, day } = dosDateTime(new Date());
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const file = Bun.file(entry.path);
    if (!(await file.exists())) continue;
    const name = encoder.encode(entry.name);
    const start = offset;
    const header = bytes(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, FLAGS, true);
      view.setUint16(10, time, true);
      view.setUint16(12, day, true);
      view.setUint16(26, name.length, true);
    });
    yield header;
    yield name;
    offset += header.length + name.length;

    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of file.stream()) {
      crc = crc32Update(crc, chunk);
      size += chunk.length;
      yield chunk;
    }
    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = bytes(16, (view) => {
      view.setUint32(0, 0x08074b50, true);
      view.setUint32(4, finalCrc, true);
      view.setUint32(8, size, true);
      view.setUint32(12, size, true);
    });
    yield descriptor;
    offset += size + descriptor.length;

    const needsZip64 = start >= zip64Threshold;
    const extra = needsZip64
      ? bytes(12, (view) => {
          view.setUint16(0, 1, true);
          view.setUint16(2, 8, true);
          view.setBigUint64(4, BigInt(start), true);
        })
      : new Uint8Array();
    central.push(
      bytes(46, (view) => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, VERSION, true);
        view.setUint16(6, VERSION, true);
        view.setUint16(8, FLAGS, true);
        view.setUint16(12, time, true);
        view.setUint16(14, day, true);
        view.setUint32(16, finalCrc, true);
        view.setUint32(20, size, true);
        view.setUint32(24, size, true);
        view.setUint16(28, name.length, true);
        view.setUint16(30, extra.length, true);
        view.setUint32(42, needsZip64 ? 0xffffffff : start, true);
      }),
      name,
      extra,
    );
  }

  const directoryStart = offset;
  let directorySize = 0;
  const count = central.length / 3;
  for (const part of central) {
    directorySize += part.length;
    yield part;
  }

  const useZip64 = directoryStart >= zip64Threshold || count >= 0xffff;
  if (useZip64) {
    const recordStart = directoryStart + directorySize;
    yield bytes(56, (view) => {
      view.setUint32(0, 0x06064b50, true);
      view.setBigUint64(4, 44n, true);
      view.setUint16(12, VERSION, true);
      view.setUint16(14, VERSION, true);
      view.setBigUint64(24, BigInt(count), true);
      view.setBigUint64(32, BigInt(count), true);
      view.setBigUint64(40, BigInt(directorySize), true);
      view.setBigUint64(48, BigInt(directoryStart), true);
    });
    yield bytes(20, (view) => {
      view.setUint32(0, 0x07064b50, true);
      view.setBigUint64(8, BigInt(recordStart), true);
      view.setUint32(16, 1, true);
    });
  }
  yield bytes(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, useZip64 ? 0xffff : count, true);
    view.setUint16(10, useZip64 ? 0xffff : count, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, useZip64 ? 0xffffffff : directoryStart, true);
  });
}

/** Cria o ZIP à medida que é descarregado, sem guardar o álbum em memória. */
export function zipStream(entries: ZipEntry[], zip64Threshold = 0xffffffff, onClose?: () => void): ReadableStream<Uint8Array> {
  const iterator = archive(entries, zip64Threshold);
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          onClose?.();
        } else controller.enqueue(value);
      } catch (error) {
        onClose?.();
        controller.error(error);
      }
    },
    async cancel() {
      onClose?.();
      await iterator.return(undefined);
    },
  });
}
