import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthResponse } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check for load balancers and Render' })
  @ApiOkResponse({
    description: 'API and database are reachable',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2026-07-16T04:00:00.000Z' },
        uptimeSeconds: { type: 'number', example: 42 },
        database: { type: 'string', example: 'up' },
      },
    },
  })
  getHealth(): Promise<HealthResponse> {
    return this.appService.getHealth();
  }
}
