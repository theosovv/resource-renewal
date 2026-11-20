import {
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, type ApiProblem } from './api.exception.js';

@Catch()
export class ApiProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      this.send(response, exception.getStatus(), exception.problem);
      return;
    }

    if (exception instanceof BadRequestException) {
      this.send(response, HttpStatus.BAD_REQUEST, {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }

  private send(response: Response, status: number, problem: ApiProblem): void {
    response.status(status).type('application/problem+json').json(problem);
  }
}
