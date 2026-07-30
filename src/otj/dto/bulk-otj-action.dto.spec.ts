import { ValidationException } from '../../common/exceptions/validation.exception.js';
import { ValidationPipe } from '../../common/pipes/validation.pipe.js';

import {
  BULK_OTJ_ACTION_MAX_IDS,
  BulkOtjApproveDto,
  BulkOtjRejectDto,
} from './bulk-otj-action.dto.js';

import type { ArgumentMetadata } from '@nestjs/common';

/**
 * F1.2.3 AC3 and AC4.
 *
 * Runs the real global `ValidationPipe` rather than calling class-validator
 * directly, so these assert what an HTTP caller actually gets — including the
 * `transform`/`whitelist` settings the app is configured with. A hand-rolled
 * validate() call can pass while the deployed pipe behaves differently.
 */
describe('bulk OTJ action DTOs', () => {
  const pipe = new ValidationPipe();

  /**
   * Must be a genuine v4 UUID: the third group starts with `4` and the fourth
   * with `8`. `@IsUUID('4')` rejects other versions, so a v1-shaped fixture
   * makes every negative case pass for the wrong reason.
   */
  const uuid = (n: number) =>
    `1b4e28ba-2fa1-4d2b-883f-${String(n).padStart(12, '0')}`;

  const meta = (metatype: unknown): ArgumentMetadata =>
    ({ type: 'body', metatype }) as ArgumentMetadata;

  const transform = (metatype: unknown, value: unknown) =>
    pipe.transform(value, meta(metatype));

  describe('rejection reason (AC3 — mandatory, minimum 10 characters)', () => {
    it('rejects a request with no reason at all', async () => {
      // The approvals UI enforced this with a live counter, but nothing did
      // server-side: a direct API call could reject an apprentice's work with
      // no explanation.
      await expect(
        transform(BulkOtjRejectDto, { ids: [uuid(1)] }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('rejects a reason shorter than 10 characters', async () => {
      await expect(
        transform(BulkOtjRejectDto, { ids: [uuid(1)], reason: 'too short' }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('rejects whitespace padded out to 10 characters', async () => {
      // Without the trim transform, ten spaces satisfies a ten-character
      // minimum and the apprentice receives a blank explanation.
      await expect(
        transform(BulkOtjRejectDto, { ids: [uuid(1)], reason: '          ' }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('accepts a reason of exactly 10 characters', async () => {
      const result = (await transform(BulkOtjRejectDto, {
        ids: [uuid(1)],
        reason: '0123456789',
      })) as BulkOtjRejectDto;

      expect(result.reason).toBe('0123456789');
    });

    it('stores the trimmed reason', async () => {
      const result = (await transform(BulkOtjRejectDto, {
        ids: [uuid(1)],
        reason: '  Evidence is missing  ',
      })) as BulkOtjRejectDto;

      expect(result.reason).toBe('Evidence is missing');
    });
  });

  describe('batch size (AC4 — up to 20 entries)', () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => uuid(i + 1));

    it(`accepts exactly ${BULK_OTJ_ACTION_MAX_IDS} ids`, async () => {
      const result = (await transform(BulkOtjApproveDto, {
        ids: ids(BULK_OTJ_ACTION_MAX_IDS),
      })) as BulkOtjApproveDto;

      expect(result.ids).toHaveLength(BULK_OTJ_ACTION_MAX_IDS);
    });

    it(`rejects ${BULK_OTJ_ACTION_MAX_IDS + 1} ids`, async () => {
      await expect(
        transform(BulkOtjApproveDto, { ids: ids(BULK_OTJ_ACTION_MAX_IDS + 1) }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('applies the same cap to rejection', async () => {
      await expect(
        transform(BulkOtjRejectDto, {
          ids: ids(BULK_OTJ_ACTION_MAX_IDS + 1),
          reason: 'Evidence is missing',
        }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('rejects an empty id list', async () => {
      await expect(
        transform(BulkOtjApproveDto, { ids: [] }),
      ).rejects.toBeInstanceOf(ValidationException);
    });
  });

  describe('approval', () => {
    it('does not require a comment', async () => {
      // Only rejection needs an explanation. Requiring one to approve would
      // make the common path the slow one.
      const result = (await transform(BulkOtjApproveDto, {
        ids: [uuid(1)],
      })) as BulkOtjApproveDto;

      expect(result.ids).toEqual([uuid(1)]);
    });
  });
});
