import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ApiException } from '../../common/errors/api.exception.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';
import { SessionCookieService } from './session-cookie.service.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    if (request.method === 'OPTIONS') {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const rawToken = this.cookies.readRawToken(request);
    if (!rawToken) {
      if (this.cookies.hasSessionCookie(request)) {
        this.cookies.clear(http.getResponse<Response>());
      }
      throw ApiException.unauthorized();
    }

    const authContext = await this.authService.authenticate(rawToken);
    if (!authContext) {
      this.cookies.clear(http.getResponse<Response>());
      throw ApiException.unauthorized();
    }
    request.authContext = authContext;
    return true;
  }
}
