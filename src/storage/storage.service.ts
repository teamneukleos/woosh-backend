import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentTypeForKey } from './upload-policy';
import {
  decodeStorageKey,
  destroyOnCloudinary,
  uploadToCloudinary,
} from './cloudinary';

const LOCAL_ROOT = path.join(process.cwd(), 'uploads');

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(
      this.cloudName() && this.apiKey() && this.apiSecret(),
    );
  }

  publicUrl(key: string) {
    const base =
      this.config.get<string>('FRONTEND_URL')?.replace(/\/$/, '') ??
      'http://localhost:3000';
    return `${base}/api/uploads/${key}`;
  }

  async store(input: {
    buffer: Buffer;
    filename: string;
    contentType: string;
    folder?: string;
  }) {
    this.assertDurableStorageInProduction();
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const publicId = `${randomUUID()}-${safeName.replace(/\.[^.]+$/, '')}`;
    const folder = this.cloudFolder(input.folder ?? 'uploads');

    if (this.configured()) {
      const stored = await uploadToCloudinary({
        cloudName: this.cloudName(),
        apiKey: this.apiKey(),
        apiSecret: this.apiSecret(),
        buffer: input.buffer,
        filename: input.filename,
        contentType: input.contentType,
        folder,
        publicId,
      });
      this.logger.log(`Uploaded ${stored.key}`);
      return { url: stored.url, key: stored.key, provider: 'cloudinary' as const };
    }

    const key = `${input.folder ?? 'uploads'}/${randomUUID()}-${safeName}`;
    const full = this.resolveLocal(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.buffer);
    return { url: this.publicUrl(key), key, provider: 'local' as const };
  }

  async read(key: string) {
    if (decodeStorageKey(key)) {
      throw new NotFoundException('Cloudinary assets are served from the CDN URL.');
    }
    this.assertDurableStorageInProduction();
    try {
      return await readFile(this.resolveLocal(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new NotFoundException('Upload not found.');
      throw error;
    }
  }

  async remove(key?: string | null) {
    if (!key) return;
    const cloudinary = decodeStorageKey(key);
    if (cloudinary) {
      if (!this.configured()) return;
      await destroyOnCloudinary({
        cloudName: this.cloudName(),
        apiKey: this.apiKey(),
        apiSecret: this.apiSecret(),
        publicId: cloudinary.publicId,
        resourceType: cloudinary.resourceType,
      });
      return;
    }
    this.assertDurableStorageInProduction();
    await unlink(this.resolveLocal(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  contentType(key: string) {
    return contentTypeForKey(key);
  }

  private cloudName() {
    return this.config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim() ?? '';
  }

  private apiKey() {
    return this.config.get<string>('CLOUDINARY_API_KEY')?.trim() ?? '';
  }

  private apiSecret() {
    return this.config.get<string>('CLOUDINARY_API_SECRET')?.trim() ?? '';
  }

  private cloudFolder(folder: string) {
    const root =
      this.config.get<string>('CLOUDINARY_FOLDER')?.trim().replace(/\/$/, '') ||
      'woosh';
    const safe = folder.replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/^\/+|\/+$/g, '');
    return `${root}/${safe}`;
  }

  private assertDurableStorageInProduction() {
    if (process.env.NODE_ENV === 'production' && !this.configured()) {
      throw new BadRequestException(
        'Cloudinary is required for uploads in production',
      );
    }
  }

  private resolveLocal(key: string) {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
      throw new BadRequestException('Invalid upload path');
    }
    const full = path.resolve(LOCAL_ROOT, normalized);
    if (!full.startsWith(path.resolve(LOCAL_ROOT))) {
      throw new BadRequestException('Invalid upload path');
    }
    return full;
  }
}
