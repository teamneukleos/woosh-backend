import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CorsIoAdapter, frontendOrigin } from './common/socket.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new CorsIoAdapter(app));
  app.enableCors({
    origin: frontendOrigin(),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Woosh API')
    .setDescription(
      'Creator campaign marketplace API. Identity through campaign execution and Paystack payouts (72h hold, disputes, signed webhook) are live. The Next.js app is not wired to this server yet.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'Authorization' },
      'cron',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
}
bootstrap();
