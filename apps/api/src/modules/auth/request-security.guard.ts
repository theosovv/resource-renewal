import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../common/errors/api.exception.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

@Injectable()
export class RequestSecurityGuard implements CanActivate {
  private readonly webOrigin: string;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'OPTIONS') {
      return true;
    }

    const origin = request.get('Origin');
    const fetchSite = request.get('Sec-Fetch-Site');
    const unsafe = !SAFE_METHODS.has(request.method);
    if (unsafe && ((origin !== undefined && origin !== this.webOrigin) || fetchSite === 'cross-site')) {
      throw ApiException.forbidden('Cross-origin request is forbidden');
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      isPublic &&
      unsafe &&
      !JSON_CONTENT_TYPE.test(request.headers['content-type'] ?? '')
    ) {
      throw ApiException.validation('Content-Type must be application/json');
    }
    return true;
  }
}
