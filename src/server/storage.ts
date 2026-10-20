import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export const VIDEO_DIR = path.resolve('.data', 'videos');

fs.mkdirSync(VIDEO_DIR, { recursive: true });

export async function saveVideo(jobId: string, bytes: Buffer): Promise<string> {
  await fs.promises.writeFile(path.join(VIDEO_DIR, `${jobId}.mp4`), bytes);
  return `/media/${jobId}.mp4`;
}

export function makeThumbnail(jobId: string): Promise<string | null> {
  const input = path.join(VIDEO_DIR, `${jobId}.mp4`);
  const output = path.join(VIDEO_DIR, `${jobId}.jpg`);
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', '-vf', 'scale=320:-2', output]);
    proc.on('error', () => resolve(null));
    proc.on('close', code => resolve(code === 0 ? `/media/${jobId}.jpg` : null));
  });
}

export async function removeVideoFiles(jobId: string) {
  for (const ext of ['mp4', 'jpg']) {
    await fs.promises.rm(path.join(VIDEO_DIR, `${jobId}.${ext}`), { force: true });
  }
}
