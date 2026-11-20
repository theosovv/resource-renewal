import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'SELF_DECISION_FORBIDDEN'
  | 'RESOURCE_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_ALREADY_ACTIVE'
  | 'INVALID_STATE_TRANSITION'
  | 'RESOURCE_SNAPSHOT_MISMATCH'
  | 'INTERNAL_ERROR';

export interface ApiProblem {
  status: number;
  code: ApiErrorCode;
  message: string;
}

export class ApiException extends HttpException {
  constructor(
    public readonly problem: ApiProblem,
    status: HttpStatus,
  ) {
    super(problem, status);
  }

  static validation(message = 'Request validation failed'): ApiException {
    return new ApiException(
      { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR', message },
      HttpStatus.BAD_REQUEST,
    );
  }

  static unauthorized(message = 'Authentication required'): ApiException {
    return new ApiException(
      { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED', message },
      HttpStatus.UNAUTHORIZED,
    );
  }

  static forbidden(message = 'Access to this workspace or action is forbidden'): ApiException {
    return new ApiException(
      { status: HttpStatus.FORBIDDEN, code: 'FORBIDDEN', message },
      HttpStatus.FORBIDDEN,
    );
  }

  static csrfInvalid(): ApiException {
    return new ApiException(
      {
        status: HttpStatus.FORBIDDEN,
        code: 'CSRF_INVALID',
        message: 'A valid session-bound CSRF token is required',
      },
      HttpStatus.FORBIDDEN,
    );
  }

  static selfDecisionForbidden(): ApiException {
    return new ApiException(
      {
        status: HttpStatus.FORBIDDEN,
        code: 'SELF_DECISION_FORBIDDEN',
        message: 'The request creator cannot approve or reject it',
      },
      HttpStatus.FORBIDDEN,
    );
  }

  static resourceNotFound(): ApiException {
    return new ApiException(
      { status: HttpStatus.NOT_FOUND, code: 'RESOURCE_NOT_FOUND', message: 'Resource not found' },
      HttpStatus.NOT_FOUND,
    );
  }

  static requestNotFound(): ApiException {
    return new ApiException(
      { status: HttpStatus.NOT_FOUND, code: 'REQUEST_NOT_FOUND', message: 'Request not found' },
      HttpStatus.NOT_FOUND,
    );
  }

  static requestAlreadyActive(): ApiException {
    return new ApiException(
      {
        status: HttpStatus.CONFLICT,
        code: 'REQUEST_ALREADY_ACTIVE',
        message: 'The resource already has an active renewal request',
      },
      HttpStatus.CONFLICT,
    );
  }

  static invalidStateTransition(): ApiException {
    return new ApiException(
      {
        status: HttpStatus.CONFLICT,
        code: 'INVALID_STATE_TRANSITION',
        message: 'The request state has already changed',
      },
      HttpStatus.CONFLICT,
    );
  }

  static resourceSnapshotMismatch(): ApiException {
    return new ApiException(
      {
        status: HttpStatus.CONFLICT,
        code: 'RESOURCE_SNAPSHOT_MISMATCH',
        message: 'The resource no longer matches the request snapshot',
      },
      HttpStatus.CONFLICT,
    );
  }
}
