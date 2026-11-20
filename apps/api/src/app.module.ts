import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { resolve } from 'node:path';
import { ApiProblemFilter } from './common/errors/api-problem.filter.js';
import { validateEnvironment } from './config/environment.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RenewalsModule } from './modules/renewals/renewals.module.js';
import { ResourcesModule } from './modules/resources/resources.module.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: false,
      envFilePath: [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')],
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    ResourcesModule,
    RenewalsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiProblemFilter }],
})
export class AppModule {}
