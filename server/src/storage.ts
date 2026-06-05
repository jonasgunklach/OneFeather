import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, copyFileSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';

// Pluggable blob storage. Today: local filesystem. A future S3/MinIO driver
// implements the same interface and is selected via STORAGE_DRIVER / env.
export interface StorageDriver {
  put(key: string, data: Readable): Promise<void>;
  get(key: string): Readable;
  delete(key: string): Promise<void>;
  stat(key: string): { size: number };
  stream(key: string, range?: { start: number, end: number }): Readable;
  copy(srcKey: string, destKey: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  private path(key: string) {
    // Keys are app-generated (node ids); keep them flat but guard traversal.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.root, safe);
  }

  async put(key: string, data: Readable): Promise<void> {
    const dest = this.path(key);
    mkdirSync(dirname(dest), { recursive: true });
    await pipeline(data, createWriteStream(dest));
  }

  get(key: string): Readable {
    return createReadStream(this.path(key));
  }

  stat(key: string): { size: number } {
    return { size: statSync(this.path(key)).size };
  }

  // Stream a whole file or a byte range (for HTTP Range requests / video seeking).
  stream(key: string, range?: { start: number, end: number }): Readable {
    return range ? createReadStream(this.path(key), { start: range.start, end: range.end }) : createReadStream(this.path(key));
  }

  async copy(srcKey: string, destKey: string): Promise<void> {
    const dest = this.path(destKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(this.path(srcKey), dest);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

const root = process.env.STORAGE_PATH || join(process.cwd(), 'storage');
export const storage: StorageDriver = new LocalStorage(root);
