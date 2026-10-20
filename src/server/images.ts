export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface DecodedImage {
  bytes: Buffer;
  mimeType: string;
}

export function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

export function decodeImage(dataUrl: string): DecodedImage | null {
  const bytes = decodeDataUrl(dataUrl);
  if (!bytes) return null;
  const mimeType = sniffMime(bytes);
  if (!mimeType) return null;
  return { bytes, mimeType };
}

export function normalizeTag(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TAG_PATTERN = /(?<![\w@])@([a-z0-9][a-z0-9_-]*)/gi;

export function extractTags(prompt: string): string[] {
  const found: string[] = [];
  for (const match of prompt.matchAll(TAG_PATTERN)) {
    const tag = match[1].toLowerCase();
    if (!found.includes(tag)) found.push(tag);
  }
  return found;
}
