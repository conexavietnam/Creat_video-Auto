export interface ImageSize {
  width: number;
  height: number;
}

function png(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpeg(bytes: Buffer): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function webp(bytes: Buffer): ImageSize | null {
  if (bytes.length < 30) return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function imageSize(bytes: Buffer): ImageSize | null {
  try {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return png(bytes);
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return webp(bytes);
  } catch {
    return null;
  }
  return null;
}

const RATIOS: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

export function nearestAspectRatio(size: ImageSize, allowed: string[]): string | null {
  if (!size.width || !size.height) return null;
  const ratio = size.width / size.height;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const label of allowed) {
    const target = RATIOS[label];
    if (!target) continue;
    const distance = Math.abs(Math.log(ratio / target));
    if (distance < bestDistance) {
      best = label;
      bestDistance = distance;
    }
  }
  return best;
}
