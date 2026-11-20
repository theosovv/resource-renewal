import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { RenewalsController } from './renewals.controller.js';
import { RenewalsService } from './renewals.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [RenewalsController],
  providers: [RenewalsService],
})
export class RenewalsModule {}
