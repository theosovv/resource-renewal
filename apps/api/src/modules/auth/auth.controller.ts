import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { components } from '@resource-renewal/contracts';
import type { Response } from 'express';
import { ApiException } from '../../common/errors/api.exception.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { CsrfService } from './csrf.service.js';
import { Public } from './public.decorator.js';
import { SessionCookieService } from './session-cookie.service.js';

type LoginResponse = components['schemas']['LoginResponse'];
type CsrfResponse = components['schemas']['CsrfResponse'];
type CurrentUser = components['schemas']['CurrentUser'];

interface LoginInput {
  email: string;
  password: string;
}

function parseLoginInput(body: unknown): LoginInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiException.validation();
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'email' && key !== 'password')) {
    throw ApiException.validation();
  }
  if (
    typeof input.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
    typeof input.password !== 'string' ||
    input.password.length === 0
  ) {
    throw ApiException.validation();
  }
  return { email: input.email, password: input.password };
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(CsrfService) private readonly csrfService: CsrfService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const input = parseLoginInput(body);
    const result = await this.authService.login(input.email, input.password);
    if (!result) {
      throw ApiException.unauthorized('Invalid email or password');
    }

    this.cookies.set(response, result.rawToken, result.absoluteExpiresAt);
    return {
      csrfToken: this.csrfService.create(result.context),
      user: result.context.user,
    };
  }

  @Get('csrf')
  csrf(@Req() request: AuthenticatedRequest): CsrfResponse {
    return { csrfToken: this.csrfService.create(request.authContext) };
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest): CurrentUser {
    return request.authContext.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request.authContext.sessionId);
    this.cookies.clear(response);
  }
}
