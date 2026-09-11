import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorageService } from './storage.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Get('{*path}')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Serve a locally stored upload (dev without Cloudinary)' })
  async get(@Param('path') path: string) {
    const key = Array.isArray(path) ? path.join('/') : path;
    const buffer = await this.storage.read(key);
    return new StreamableFile(buffer, {
      type: this.storage.contentType(key),
      disposition: 'inline',
    });
  }
}
