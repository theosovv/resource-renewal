import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RenewalRequestStatus } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequireWorkspaceRole } from '../auth/workspace-access.decorator.js';
import type {
  RenewalRequestDetailResponse,
  RenewalRequestResponse,
} from './renewals.serializer.js';
import { RenewalsService, type RenewalRequestFilters } from './renewals.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestStatuses = new Set<string>(Object.values(RenewalRequestStatus));

function parseCreateInput(body: unknown): { resourceId: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiException.validation();
  }
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'resourceId') ||
    typeof input.resourceId !== 'string' ||
    !UUID_PATTERN.test(input.resourceId)
  ) {
    throw ApiException.validation();
  }
  return { resourceId: input.resourceId };
}

function parseFilters(query: Record<string, unknown>): RenewalRequestFilters {
  if (Object.keys(query).some((key) => key !== 'resourceId' && key !== 'status')) {
    throw ApiException.validation();
  }

  const filters: RenewalRequestFilters = {};
  if (query.resourceId !== undefined) {
    if (typeof query.resourceId !== 'string' || !UUID_PATTERN.test(query.resourceId)) {
      throw ApiException.validation();
    }
    filters.resourceId = query.resourceId;
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !requestStatuses.has(query.status)) {
      throw ApiException.validation();
    }
    filters.status = query.status as RenewalRequestStatus;
  }
  return filters;
}

@Controller('workspaces/:workspaceId/requests')
export class RenewalsController {
  constructor(@Inject(RenewalsService) private readonly renewals: RenewalsService) {}

  @Get()
  @RequireWorkspaceRole()
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<{ items: RenewalRequestResponse[]; total: number }> {
    return this.renewals.list(workspaceId, parseFilters(query));
  }

  @Post()
  @RequireWorkspaceRole('INITIATOR')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<RenewalRequestResponse> {
    const input = parseCreateInput(body);
    return this.renewals.create(workspaceId, input.resourceId, request.authContext.user.id);
  }

  @Get(':requestId')
  @RequireWorkspaceRole()
  detail(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<RenewalRequestDetailResponse> {
    return this.renewals.detail(workspaceId, requestId);
  }

  @Post(':requestId/approve')
  @RequireWorkspaceRole('APPROVER')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RenewalRequestResponse> {
    return this.renewals.approve(workspaceId, requestId, request.authContext.user.id);
  }

  @Post(':requestId/reject')
  @RequireWorkspaceRole('APPROVER')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RenewalRequestResponse> {
    return this.renewals.reject(workspaceId, requestId, request.authContext.user.id);
  }

  @Post(':requestId/retry')
  @RequireWorkspaceRole('APPROVER')
  @HttpCode(HttpStatus.OK)
  retry(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RenewalRequestResponse> {
    return this.renewals.retry(workspaceId, requestId, request.authContext.user.id);
  }
}
