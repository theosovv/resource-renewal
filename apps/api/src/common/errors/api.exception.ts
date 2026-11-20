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
}
