const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{20,}/g;
const MASK = '[đã ẩn]';

export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text.replace(GOOGLE_KEY, MASK);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(MASK);
  }
  return out;
}
