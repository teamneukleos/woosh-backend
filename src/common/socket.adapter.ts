import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

export function frontendOrigin() {
  return process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
}

export class CorsIoAdapter extends IoAdapter {
  constructor(app: INestApplication) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: frontendOrigin(),
        credentials: true,
      },
      path: '/socket.io',
    });
  }
}
