import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { RequestSecurityGuard } from './request-security.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionCookieService } from './session-cookie.service.js';
import { WorkspaceAccessGuard } from './workspace-access.guard.js';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    CsrfService,
    SessionCookieService,
    WorkspaceAccessGuard,
    { provide: APP_GUARD, useClass: RequestSecurityGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [WorkspaceAccessGuard],
})
export class AuthModule {}
