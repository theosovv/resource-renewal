import type { components } from '@resource-renewal/contracts';
import type { Request } from 'express';

export type CurrentUser = components['schemas']['CurrentUser'];
export type Membership = components['schemas']['Membership'];
export type WorkspaceRole = components['schemas']['Role'];

export interface AuthContext {
  sessionId: string;
  tokenHash: string;
  user: CurrentUser;
}

export interface AuthenticatedRequest extends Request {
  authContext: AuthContext;
  workspaceMembership?: Membership;
}
