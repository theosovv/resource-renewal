import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'rr_session';
const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

@Injectable()
export class SessionCookieService {
  private readonly options: CookieOptions;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.options = {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.getOrThrow<boolean>('COOKIE_SECURE'),
      path: '/',
    };
  }

  set(response: Response, rawToken: string, absoluteExpiresAt: Date): void {
    response.cookie(SESSION_COOKIE_NAME, rawToken, {
      ...this.options,
      expires: absoluteExpiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, this.options);
  }

  hasSessionCookie(request: Request): boolean {
    return this.readCookie(request) !== undefined;
  }

  readRawToken(request: Request): string | null {
    const value = this.readCookie(request);
    return value && BASE64URL_TOKEN_PATTERN.test(value) ? value : null;
  }

  private readCookie(request: Request): string | undefined {
    const header = request.headers.cookie;
    if (!header) {
      return undefined;
    }
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) {
        continue;
      }
      return part.slice(separator + 1).trim();
    }
    return undefined;
  }
}
