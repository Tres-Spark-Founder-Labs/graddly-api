import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { PaginatedResult } from '../pagination/paginated-result.js';

import { ResponseInterceptor } from './response.interceptor.js';

import type { CallHandler, ExecutionContext } from '@nestjs/common';

/**
 * The envelope is the platform's response contract, and the one place it must
 * *not* apply is a file download. Three CSV routes shipped wrapped in
 * `{"message":"Success","data":"Provider,Active…"}` — a `.csv` no spreadsheet
 * opens, served with a 200 and a body, which looks exactly like success to
 * any test that checks the status code alone.
 *
 * These pin the rule that replaced the per-route decorator: a handler that has
 * already set a non-JSON Content-Type is serving a file, and is left alone.
 */
describe('ResponseInterceptor', () => {
  const reflector = {
    get: jest.fn(),
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const contextWith = (contentType?: string): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getResponse: () => ({
          getHeader: (name: string) =>
            name.toLowerCase() === 'content-type' ? contentType : undefined,
        }),
        getRequest: () => ({ url: '/api/v1/anything' }),
      }),
    }) as unknown as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler =>
    ({ handle: () => of(value) }) as CallHandler;

  let interceptor: ResponseInterceptor<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    interceptor = new ResponseInterceptor(reflector);
  });

  it('wraps a normal JSON response', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextWith(), handlerReturning({ id: 'x' })),
    );

    expect(result).toEqual({ message: 'Success', data: { id: 'x' } });
  });

  it('wraps when the handler explicitly set application/json', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        contextWith('application/json; charset=utf-8'),
        handlerReturning({ id: 'x' }),
      ),
    );

    expect(result).toEqual({ message: 'Success', data: { id: 'x' } });
  });

  it('leaves a CSV download untouched', async () => {
    const csv = 'Provider,Active apprentices\nNorthstar,4\n';

    const result = await lastValueFrom(
      interceptor.intercept(
        contextWith('text/csv; charset=utf-8'),
        handlerReturning(csv),
      ),
    );

    expect(result).toBe(csv);
  });

  it('leaves a Word download untouched', async () => {
    const bytes = Buffer.from('PK');

    const result = await lastValueFrom(
      interceptor.intercept(
        contextWith(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
        handlerReturning(bytes),
      ),
    );

    expect(result).toBe(bytes);
  });

  it('leaves a PDF download untouched', async () => {
    const bytes = Buffer.from('%PDF');

    const result = await lastValueFrom(
      interceptor.intercept(
        contextWith('application/pdf'),
        handlerReturning(bytes),
      ),
    );

    expect(result).toBe(bytes);
  });

  it('still honours @SkipResponseEnvelope when no header is set', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

    const result = await lastValueFrom(
      interceptor.intercept(contextWith(), handlerReturning('raw')),
    );

    expect(result).toBe('raw');
  });

  it('flattens a PaginatedResult into data + meta', async () => {
    const paginated = new PaginatedResult([{ id: 'a' }], {
      total: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
    });

    const result = (await lastValueFrom(
      interceptor.intercept(contextWith(), handlerReturning(paginated)),
    )) as { data: unknown; meta: unknown };

    expect(result.data).toEqual([{ id: 'a' }]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
    });
  });
});
