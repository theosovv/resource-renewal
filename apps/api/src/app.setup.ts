import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  const webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allowedOrigin: string | false) => void,
    ) => callback(null, requestOrigin === webOrigin ? requestOrigin : false),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    optionsSuccessStatus: 204,
  });
}
