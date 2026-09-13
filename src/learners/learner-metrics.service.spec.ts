import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  resetSynchronousTenantFallback,
  runWithCorrelationId,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EnrolmentJourneyService } from '../enrolments/enrolment-journey.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { User } from '../users/entities/user.entity.js';

import { LearnerMetricsService } from './learner-metrics.service.js';

/**
 * The display-name hydration rule, asserted rather than described.
 *
 * `loadTutorNames` and `loadEmployerContacts` read `users` for a party the
 * caller's organisation does not contain — the tutor belongs to the provider,
 * the employer contact to the employer — so both run under the RLS bootstrap
 * flag. That flag is a bypass, and the only things keeping it honest are
 * conventions: display fields only, the narrowest possible window, and ids
 * that came from rows the caller could already read.
 *
 * Two call sites that happen to agree are not a pattern, which is why the
 * conventions are pinned here and written out in
 * `docs/employer-learner-access.md`.
 */
describe('LearnerMetricsService — display-name hydration', () => {
  const userRepo = { find: jest.fn() };
  const membershipRepo = { find: jest.fn() };

  let service: LearnerMetricsService;
  /** `getRlsBootstrap()` as observed from inside each repository call. */
  let flagDuringRead: boolean[];

  beforeEach(async () => {
    jest.clearAllMocks();
    resetSynchronousTenantFallback();
    flagDuringRead = [];

    userRepo.find.mockImplementation(() => {
      flagDuringRead.push(getRlsBootstrap());
      return Promise.resolve([
        { id: 'tutor-1', firstName: 'Rowan', lastName: 'Bell' },
        { id: 'tutor-2', firstName: '  ', lastName: ' ' },
      ]);
    });
    membershipRepo.find.mockImplementation(() => {
      flagDuringRead.push(getRlsBootstrap());
      return Promise.resolve([
        {
          organisation: { id: 'employer-org-1' },
          user: {
            firstName: 'Dana',
            lastName: 'Frost',
            email: 'dana@employer.example.com',
          },
        },
      ]);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerMetricsService,
        { provide: getRepositoryToken(Enrolment), useValue: {} },
        { provide: getRepositoryToken(Review), useValue: {} },
        { provide: getRepositoryToken(OtjLogEntry), useValue: {} },
        { provide: getRepositoryToken(MessageThread), useValue: {} },
        { provide: getRepositoryToken(Message), useValue: {} },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: EnrolmentJourneyService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(LearnerMetricsService);
  });

  /**
   * The flag lives in AsyncLocalStorage, so a spec that calls the service
   * outside a store would see `setRlsBootstrap` write to the fallback and
   * `getRlsBootstrap` still answer false — green, and proving nothing.
   */
  const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithCorrelationId({ correlationId: 'metrics-spec' }, fn);

  describe('loadTutorNames', () => {
    it('reads under the bootstrap flag and puts it back', async () => {
      await inRequest(async () => {
        expect(getRlsBootstrap()).toBe(false);

        await service.loadTutorNames(['tutor-1']);

        // Set for the read itself…
        expect(flagDuringRead).toEqual([true]);
        // …and not left on for whatever the request does next.
        expect(getRlsBootstrap()).toBe(false);
      });
    });

    it('restores a bootstrap that was already set, rather than clearing it', async () => {
      await inRequest(async () => {
        setRlsBootstrap(true);

        await service.loadTutorNames(['tutor-1']);

        expect(getRlsBootstrap()).toBe(true);
      });
    });

    it('selects the display fields and nothing else', async () => {
      await inRequest(async () => {
        await service.loadTutorNames(['tutor-1']);
      });

      const [options] = userRepo.find.mock.calls[0] as [
        { select: string[]; where: unknown },
      ];
      /*
       * Exact, not a superset. `users` carries `password` and `mfaSecret`,
       * kept off the wire by `select: false` — an ORM convention guarding a
       * database boundary, and a bypassed row policy is the wrong place to
       * start relying on it. Three fields, not the four
       * `enrichEnrolmentsForDisplay` uses: its labels carry the email and the
       * tutor DTO is `{ userId, name }`.
       */
      expect(options.select).toEqual(['id', 'firstName', 'lastName']);
    });

    it('does not open the window at all for an empty id list', async () => {
      await inRequest(async () => {
        const names = await service.loadTutorNames([]);

        expect(names.size).toBe(0);
        expect(userRepo.find).not.toHaveBeenCalled();
        expect(flagDuringRead).toEqual([]);
        expect(getRlsBootstrap()).toBe(false);
      });
    });

    it('maps ids to trimmed display names', async () => {
      const names = await inRequest(() =>
        service.loadTutorNames(['tutor-1', 'tutor-2']),
      );

      expect(names.get('tutor-1')).toBe('Rowan Bell');
      // A user with no name is an empty label, not the string "undefined".
      expect(names.get('tutor-2')).toBe('');
      // An id the read did not return is absent rather than guessed at.
      expect(names.has('tutor-3')).toBe(false);
    });
  });

  describe('loadEmployerContacts', () => {
    it('reads under the same flag, and puts it back', async () => {
      await inRequest(async () => {
        const contacts = await service.loadEmployerContacts(['employer-org-1']);

        expect(flagDuringRead).toEqual([true]);
        expect(getRlsBootstrap()).toBe(false);
        expect(contacts.get('employer-org-1')).toEqual({
          contactName: 'Dana Frost',
          contactEmail: 'dana@employer.example.com',
        });
      });
    });

    it('does not open the window for an empty list', async () => {
      await inRequest(async () => {
        await service.loadEmployerContacts([]);

        expect(membershipRepo.find).not.toHaveBeenCalled();
        expect(flagDuringRead).toEqual([]);
      });
    });
  });
});
