import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  database: 'up' | 'down';
};

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<HealthResponse> {
    let database: 'up' | 'down' = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    const body: HealthResponse = {
      status: database === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database,
    };

    if (database === 'down') {
      throw new ServiceUnavailableException(body);
    }

    return body;
  }
}
