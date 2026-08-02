import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

import { IApiResponse } from '../interfaces/api-response.interface';
import { PaginatedResult } from '../pagination/paginated-result.js';

import { RESPONSE_MESSAGE_KEY } from './response-message.decorator';
import { SKIP_RESPONSE_ENVELOPE_KEY } from './skip-response-envelope.decorator';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  IApiResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<IApiResponse<T>> {
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      'Success';

    const skipEnvelope = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_ENVELOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const response = context.switchToHttp().getResponse<{
      getHeader?: (name: string) => unknown;
    }>();

    return next.handle().pipe(
      map((data) => {
        if (skipEnvelope || this.hasNonJsonContentType(response)) {
          return data as IApiResponse<T>;
        }
        if (data instanceof PaginatedResult) {
          return {
            message,
            data: data.items as T,
            meta: data.meta,
          };
        }
        return { message, data };
      }),
    );
  }

  /**
   * A handler that has already set a non-JSON `Content-Type` is serving a
   * file, and wrapping it in the success envelope corrupts it.
   *
   * This replaced a hardcoded `request.url.includes('/audit/export')` check,
   * which only ever protected the one route someone noticed. Two more CSV
   * downloads shipped wrapped in `{"message":"Success","data":"Provider,…"}`
   * before anyone opened one — a `.csv` no spreadsheet will open, returned
   * with a 200 and a body, which is indistinguishable from success to every
   * test that only checks the status code.
   *
   * Keying off the header the handler already had to set means the next file
   * download is protected by default rather than by remembering a decorator.
   * `@SkipResponseEnvelope()` remains for handlers that set no header.
   */
  private hasNonJsonContentType(response: {
    getHeader?: (name: string) => unknown;
  }): boolean {
    const contentType = response.getHeader?.('content-type');
    if (typeof contentType !== 'string') {
      return false;
    }
    return !contentType.toLowerCase().includes('application/json');
  }
}
