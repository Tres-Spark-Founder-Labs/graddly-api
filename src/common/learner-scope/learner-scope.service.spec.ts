import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';

import { LearnerScopeService } from './learner-scope.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

/**
 * The identity half of the D3 fix. The enforcement half is proven end-to-end in
 * `test/learner-scope-surface.e2e-spec.ts`; what belongs here is the decision
 * itself, and in particular the two ways it must not fail.
 */
describe('LearnerScopeService', () => {
  let service: LearnerScopeService;
  const find = jest.fn();
  const getMany = jest.fn();

  const queryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany,
  };

  const userWith = (over: Partial<AuthenticatedUser> = {}) =>
    ({
      id: 'user-1',
      email: 'learner@example.com',
      organisationId: 'org-1',
      roles: [OrganisationRole.MEMBER],
      ...over,
    }) as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    find.mockResolvedValue([]);
    getMany.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerScopeService,
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find, createQueryBuilder: () => queryBuilder },
        },
      ],
    }).compile();

    service = moduleRef.get(LearnerScopeService);
  });

  it('treats a member with an enrolment naming them as a learner', async () => {
    find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);

    const scope = await service.resolve(userWith());

    expect(scope).toEqual({
      isLearner: true,
      enrolmentIds: ['enr-1'],
      apprenticeIds: ['app-1'],
    });
  });

  it('treats a member with no enrolment as staff', async () => {
    // A tutor: same membership row, no enrolment naming them.
    const scope = await service.resolve(userWith());
    expect(scope.isLearner).toBe(false);
  });

  it.each([OrganisationRole.OWNER, OrganisationRole.ADMIN])(
    'treats an enrolled %s as staff, not a learner',
    async (role) => {
      find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);

      const scope = await service.resolve(userWith({ roles: [role] }));

      // Deliberate. Reversing this would lock an administrator out of their
      // own portal the moment somebody enrolled them on a programme.
      expect(scope.isLearner).toBe(false);
      expect(find).not.toHaveBeenCalled();
    },
  );

  /**
   * The fail-open this closes. `apprenticeUserId` is stamped when an apprentice
   * accepts their invitation; if that stamp is ever missing, the direct lookup
   * finds nothing and the principal would otherwise resolve as staff — an
   * authorisation boundary failing open.
   */
  it('still resolves a learner when the apprenticeUserId stamp is missing', async () => {
    find.mockResolvedValue([]);
    getMany.mockResolvedValue([{ id: 'enr-9', apprenticeId: 'app-9' }]);

    const scope = await service.resolve(userWith());

    expect(scope).toEqual({
      isLearner: true,
      enrolmentIds: ['enr-9'],
      apprenticeIds: ['app-9'],
    });
  });

  it('de-duplicates when both routes return the same enrolment', async () => {
    find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);
    getMany.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);

    const scope = await service.resolve(userWith());

    expect(scope.enrolmentIds).toEqual(['enr-1']);
    expect(scope.apprenticeIds).toEqual(['app-1']);
  });

  it('is not a learner anywhere without an active organisation', async () => {
    const scope = await service.resolve(userWith({ organisationId: undefined }));

    expect(scope.isLearner).toBe(false);
    expect(find).not.toHaveBeenCalled();
  });

  describe('ownEnrolmentIds', () => {
    /**
     * The distinction the call sites depend on. `null` means "do not narrow";
     * an empty array would mean "narrow to nothing" and would silently blank
     * the provider's approval queue.
     */
    it('returns null for staff rather than an empty array', async () => {
      await expect(service.ownEnrolmentIds(userWith())).resolves.toBeNull();
    });

    it('returns the ids for a learner', async () => {
      find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);
      await expect(service.ownEnrolmentIds(userWith())).resolves.toEqual([
        'enr-1',
      ]);
    });
  });

  describe('memoisation', () => {
    it('resolves once per user per organisation', async () => {
      find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);
      const user = userWith();

      await service.resolve(user);
      await service.resolve(user);
      await service.ownEnrolmentIds(user);

      expect(find).toHaveBeenCalledTimes(1);
    });

    it('re-resolves when the active organisation changes', async () => {
      find.mockResolvedValue([{ id: 'enr-1', apprenticeId: 'app-1' }]);
      const user = userWith();

      await service.resolve(user);
      user.organisationId = 'org-2';
      await service.resolve(user);

      expect(find).toHaveBeenCalledTimes(2);
    });
  });
});
