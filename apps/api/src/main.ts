import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const host = config.getOrThrow<string>('API_HOST');
  const port = config.getOrThrow<number>('API_PORT');

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_ORIGIN'),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}/api/v1`, 'Bootstrap');
}

bootstrap().catch(() => {
  Logger.error('API bootstrap failed; check DATABASE_URL and PostgreSQL availability', 'Bootstrap');
  process.exit(1);
});
