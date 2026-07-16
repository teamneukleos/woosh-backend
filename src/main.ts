import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

function parseCorsOrigins(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  const isProd = config.get<string>('NODE_ENV') === 'production';

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  } else if (!isProd) {
    // Local/dev: allow any origin so Swagger and localhost frontends work
    app.enableCors({ origin: true, credentials: true });
  } else {
    // Production/staging without CORS_ORIGINS: same-origin / API clients only
    app.enableCors({ origin: false });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Woosh API')
    .setDescription('Nigeria creator-brand marketplace API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.get<string>('PORT') ?? 3000);
}
bootstrap();
