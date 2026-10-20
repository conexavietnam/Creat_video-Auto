import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEY_FILE = path.resolve('.data', 'credential.key');

function loadKey(): Buffer {
  const fromEnv = process.env.CREDENTIAL_KEY;
  if (fromEnv) {
    const key = /^[0-9a-f]{64}$/i.test(fromEnv) ? Buffer.from(fromEnv, 'hex') : Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) {
      throw new Error('CREDENTIAL_KEY phải là 32 byte (64 ký tự hex hoặc base64)');
    }
    return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Thiếu biến môi trường CREDENTIAL_KEY ở môi trường production');
  }
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  console.warn('Chưa có CREDENTIAL_KEY, đã tạo khóa dev tại .data/credential.key. Production bắt buộc đặt CREDENTIAL_KEY.');
  return generated;
}

const key = loadKey();

export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptCredential(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new Error('Định dạng credential đã mã hóa không hợp lệ');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function maskIdentifier(credential: string): string {
  const digest = crypto.createHash('sha256').update(credential).digest('hex');
  return `usr_***${digest.slice(0, 4)}`;
}
