import { Test } from '@nestjs/testing';

import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  getCurrentUserId,
  runWithCorrelationId,
} from '../common/context/correlation-id-context.js';

import { DasManualController } from './das-manual.controller.js';
import { DasManualService } from './das-manual.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * Attribution, not just auditing.
 *
 * "The write is audited" and "the write is audited with the right actor" are
 * different claims, and only the second is worth anything: an audit row that
 * says a figure changed without saying who changed it answers no question
 * anybody asks of an audit trail.
 *
 * `AuditLogSubscriber` reads `getCurrentUserId()` at insert time, so these
 * tests assert the controller has set it *by the moment the service is
 * called* — capturing it inside the service double is the only way to observe
 * the window that matters.
 */
describe('DasManualController — actor attribution', () => {
  let controller: DasManualController;

  /**
   * The user id visible in the tenant context at the instant the service ran.
   *
   * Read from `getCurrentUserId()`, which reads only the AsyncLocalStorage
   * store — the one place the value lives. Each call below therefore runs
   * inside a store, as a request does under CorrelationIdMiddleware; outside
   * one the setter is a no-op and there would be nothing to observe.
   */
  let seenUserId: string | null;

  const capture = jest.fn();

  const service = {
    setLevyBalance: jest.fn(),
    replaceMonthlyEntries: jest.fn(),
    replaceTranches: jest.fn(),
    recordFundingPayment: jest.fn(),
    recordIlrReceipt: jest.fn(),
    createDonorLink: jest.fn(),
    listDonorLinks: jest.fn(),
  };

  const user = {
    id: 'user-42',
    organisationId: 'org-1',
    roles: ['admin'],
  } as unknown as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    seenUserId = null;

    // Every service method records the ambient user id at call time.
    capture.mockImplementation(() => {
      seenUserId = getCurrentUserId() ?? null;
    });
    service.setLevyBalance.mockImplementation(() => {
      capture();
      return { balance: '1.00', lastSyncedAt: new Date() };
    });
    service.replaceMonthlyEntries.mockImplementation(() => {
      capture();
      return 12;
    });
    service.replaceTranches.mockImplementation(() => {
      capture();
      return 3;
    });
    service.recordFundingPayment.mockImplementation(() => {
      capture();
      return { externalReference: 'PAY-1', amount: '1.00' };
    });
    service.recordIlrReceipt.mockImplementation(() => {
      capture();
      return { id: 'sub-1', esfaReference: 'ESFA-1' };
    });
    service.createDonorLink.mockImplementation(() => {
      capture();
      return { id: 'link-1', label: 'Main', status: 'manual' };
    });

    /**
     * The guards are overridden, not exercised. This suite is about what the
     * handler does to the tenant context once a request is through the door;
     * the owner/admin restriction is a separate concern with its own coverage
     * in roles.guard.spec.ts, and wiring the guards' real dependencies here
     * would test Nest's injector rather than attribution.
     */
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [DasManualController],
      providers: [{ provide: DasManualService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(ActiveOrganisationGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .compile();

    controller = moduleRef.get(DasManualController);
  });

  /**
   * One case per write endpoint. Six endpoints, six chances to forget the
   * attribution call, and forgetting it on one is invisible until somebody
   * needs that particular trail.
   */
  const writes: [string, () => Promise<unknown>][] = [
    [
      'POST /das/manual/levy-balance',
      () => controller.setLevyBalance(user, { balance: '48250.00' }),
    ],
    [
      'PUT /das/manual/levy-monthly',
      () =>
        controller.replaceMonthly(user, {
          months: [
            { month: '2026-04', contributions: '100.00', spend: '50.00' },
          ],
        }),
    ],
    [
      'PUT /das/manual/levy-tranches',
      () =>
        controller.replaceTranches(user, {
          donorLinkId: 'link-1',
          tranches: [{ amount: '100.00', expiresOn: '2027-04-30' }],
        }),
    ],
    [
      'POST /das/manual/funding-payments',
      () =>
        controller.recordFundingPayment(user, {
          externalReference: 'PAY-1',
          paymentDate: '2026-04-15',
          amount: '1250.00',
        }),
    ],
    [
      'POST /das/manual/ilr-receipt',
      () =>
        controller.recordIlrReceipt(user, {
          submissionId: 'sub-1',
          esfaReference: 'ESFA-1',
          submittedAt: '2026-04-16T09:30:00.000Z',
        }),
    ],
    [
      'POST /das/manual/donor-link',
      () => controller.createDonorLink(user, { label: 'Main account' }),
    ],
  ];

  it.each(writes)(
    '%s attributes the write to the calling user',
    async (_route, call) => {
      await runWithCorrelationId('request', call);

      // The value AuditLogSubscriber reads for actorUserId, and the one the
      // GUC resolver sends as app.current_user.
      expect(seenUserId).toBe('user-42');
    },
  );

  it('does not attribute to whoever wrote last', async () => {
    await runWithCorrelationId('request-1', () =>
      controller.setLevyBalance(user, { balance: '1.00' }),
    );

    const other = {
      id: 'user-99',
      organisationId: 'org-1',
      roles: ['owner'],
    } as unknown as AuthenticatedUser;
    await runWithCorrelationId('request-2', () =>
      controller.setLevyBalance(other, { balance: '2.00' }),
    );

    // A stale context would leave the second write signed by the first user —
    // the failure mode where every row in a busy hour carries one name.
    expect(seenUserId).toBe('user-99');
  });

  it('passes the caller organisation, not one from the payload', async () => {
    await controller.setLevyBalance(user, { balance: '1.00' });

    expect(service.setLevyBalance).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ balance: '1.00' }),
    );
  });
});
