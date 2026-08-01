import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AUDIT_ENTITY_TYPE } from '../audit/audit-entity-types.js';
import { AuditEventService } from '../audit/audit-event.service.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';

import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { CommitmentStatementContentDto } from './dto/commitment-statement-content.dto.js';
import { CommitmentStatementResponseDto } from './dto/commitment-statement-response.dto.js';
import { CreateCommitmentStatementDto } from './dto/create-commitment-statement.dto.js';
import { ListCommitmentStatementsQueryDto } from './dto/list-commitment-statements-query.dto.js';
import { UpdateCommitmentStatementDto } from './dto/update-commitment-statement.dto.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class CommitmentStatementsService {
  constructor(
    @InjectRepository(CommitmentStatementGroup)
    private readonly groupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly statusService: CommitmentStatementStatusService,
    private readonly pdfDispatch: PdfDispatchService,
    private readonly auditEvents: AuditEventService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    const organisationId = user.organisationId!;
    await this.assertEnrolmentMatch(
      organisationId,
      dto.enrolmentId,
      dto.apprenticeId,
    );

    const existingGroup = await this.groupRepo.findOne({
      where: { organisationId, enrolmentId: dto.enrolmentId, isDeleted: false },
    });
    if (existingGroup) {
      throw new ConflictException(
        'A commitment statement group already exists for this enrolment',
      );
    }

    const group = await this.groupRepo.save(
      this.groupRepo.create({
        organisationId,
        enrolmentId: dto.enrolmentId,
        apprenticeId: dto.apprenticeId,
        currentVersionId: null,
      }),
    );

    const statement = await this.statementRepo.save(
      this.statementRepo.create({
        organisationId,
        groupId: group.id,
        version: 1,
        status: CommitmentStatementStatus.DRAFT,
        content: dto.content as unknown as Record<string, unknown>,
        apprenticeUserId: dto.apprenticeUserId,
        tutorUserId: dto.tutorUserId,
        employerManagerUserId: dto.employerManagerUserId,
      }),
    );

    group.currentVersionId = statement.id;
    await this.groupRepo.save(group);

    return this.toResponse(statement, group);
  }

  async createVersion(
    user: AuthenticatedUser,
    groupId: string,
    dto: CreateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    const organisationId = user.organisationId!;
    const group = await this.findGroup(user, groupId);
    if (
      dto.enrolmentId !== group.enrolmentId ||
      dto.apprenticeId !== group.apprenticeId
    ) {
      throw new BadRequestException(
        'Enrolment and apprentice must match the existing commitment group',
      );
    }
    const current = await this.requireCurrentStatement(group);

    if (!this.statusService.canCreateNewVersion(current.status)) {
      throw new BadRequestException(
        'A new version can only be created when the current version is signed or cancelled',
      );
    }

    if (current.status === CommitmentStatementStatus.SIGNED) {
      this.statusService.applyTransition(
        current.status,
        CommitmentStatementStatus.SUPERSEDED,
      );
      current.status = CommitmentStatementStatus.SUPERSEDED;
      current.supersededAt = new Date();
      await this.statementRepo.save(current);
    }

    const statement = await this.statementRepo.save(
      this.statementRepo.create({
        organisationId,
        groupId: group.id,
        version: current.version + 1,
        status: CommitmentStatementStatus.DRAFT,
        content: dto.content as unknown as Record<string, unknown>,
        apprenticeUserId: dto.apprenticeUserId,
        tutorUserId: dto.tutorUserId,
        employerManagerUserId: dto.employerManagerUserId,
      }),
    );

    group.currentVersionId = statement.id;
    await this.groupRepo.save(group);

    /**
     * F1.3.3 AC1 — "any version changes".
     *
     * The subscriber sees this as an insert on `commitment_statements` plus
     * an update to the superseded row: two entries describing one act, and
     * neither of them says a new version was raised. This records the act.
     */
    await this.auditEvents.recordVersionChange({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: statement.id,
      organisationId,
      detail: `version ${current.version} superseded by version ${statement.version}`,
    });

    return this.toResponse(statement, group);
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListCommitmentStatementsQueryDto,
  ): Promise<PaginatedResult<CommitmentStatementResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const organisationId = user.organisationId!;

    const qb = this.statementRepo
      .createQueryBuilder('statement')
      .innerJoinAndSelect('statement.group', 'group')
      .where('statement.organisationId = :organisationId', { organisationId })
      .andWhere('group.isDeleted = false');

    if (query.status) {
      qb.andWhere('statement.status = :status', { status: query.status });
    }
    if (query.enrolmentId) {
      qb.andWhere('group.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    }

    qb.orderBy('statement.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row, row.group)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  /**
   * F1.3.2 AC1 — the employer reads the full text before signing, so this
   * resolves for any party to the statement rather than only its owner.
   */
  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<CommitmentStatementResponseDto> {
    const row = await this.findStatementAsParty(user, id);
    const group = await this.findGroupAsParty(user, row.groupId);

    /**
     * F1.3.3 AC1 — "audit trail records … each view".
     *
     * Recorded here rather than by the entity subscriber, which only observes
     * writes. Reading a commitment statement changes no row, so without this
     * line a view leaves no trace anywhere — and "who has seen this document"
     * is a question an Ofsted inspector actually asks.
     *
     * Awaited rather than fired and forgotten so the entry is written inside
     * the request, but `record` never throws: a failed audit write must not
     * stop the employer reading a document they are a party to.
     */
    await this.auditEvents.recordView({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: row.id,
      organisationId: row.organisationId,
      detail: `version ${row.version}`,
    });

    return this.toResponse(row, group);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    const statement = await this.findStatementEntity(user, id);
    if (statement.status !== CommitmentStatementStatus.DRAFT) {
      throw new BadRequestException('Only draft statements can be updated');
    }

    if (dto.content !== undefined) {
      statement.content = dto.content as unknown as Record<string, unknown>;
    }
    if (dto.apprenticeUserId !== undefined) {
      statement.apprenticeUserId = dto.apprenticeUserId;
    }
    if (dto.tutorUserId !== undefined) {
      statement.tutorUserId = dto.tutorUserId;
    }
    if (dto.employerManagerUserId !== undefined) {
      statement.employerManagerUserId = dto.employerManagerUserId;
    }

    const saved = await this.statementRepo.save(statement);
    const group = await this.findGroup(user, saved.groupId);
    return this.toResponse(saved, group);
  }

  async publish(
    user: AuthenticatedUser,
    id: string,
  ): Promise<CommitmentStatementResponseDto> {
    const statement = await this.findStatementEntity(user, id);
    this.statusService.applyTransition(
      statement.status,
      CommitmentStatementStatus.SUBMITTED,
    );
    statement.status = CommitmentStatementStatus.SUBMITTED;
    statement.publishedAt = new Date();
    statement.publishedByUserId = user.id;

    if (!statement.snapshotPdfJobId) {
      const job = await this.pdfDispatch.enqueue({
        organisationId: user.organisationId!,
        userId: user.id,
        template: PdfJobTemplate.COMMITMENT_SNAPSHOT,
        statementId: statement.id,
      });
      statement.snapshotPdfJobId = job.id;
    }

    const saved = await this.statementRepo.save(statement);
    const group = await this.findGroup(user, saved.groupId);
    return this.toResponse(saved, group);
  }

  async cancel(
    user: AuthenticatedUser,
    id: string,
  ): Promise<CommitmentStatementResponseDto> {
    const statement = await this.findStatementEntity(user, id);
    if (
      statement.status === CommitmentStatementStatus.SIGNED ||
      statement.status === CommitmentStatementStatus.SUPERSEDED ||
      statement.status === CommitmentStatementStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot cancel this commitment statement');
    }

    if (statement.status === CommitmentStatementStatus.AWAITING_SIGNATURES) {
      if (!this.isAdmin(user)) {
        throw new BadRequestException(
          'Only organisation admins can cancel a statement awaiting signatures',
        );
      }
    }

    this.statusService.applyTransition(
      statement.status,
      CommitmentStatementStatus.CANCELLED,
    );
    statement.status = CommitmentStatementStatus.CANCELLED;

    const saved = await this.statementRepo.save(statement);
    const group = await this.findGroup(user, saved.groupId);
    return this.toResponse(saved, group);
  }

  /**
   * Owner-scoped lookup. Used by update, publish and cancel — actions that
   * belong to the provider who drafted the statement, and which are
   * deliberately *not* widened to the other parties.
   */
  async findStatementEntity(
    user: AuthenticatedUser,
    id: string,
  ): Promise<CommitmentStatement> {
    const row = await this.statementRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!row) throw new NotFoundException('Commitment statement not found');
    return row;
  }

  /**
   * Lookup for a party to the statement, not just its owner (F1.3.2 AC1).
   *
   * Commitment statements are owned by the provider who drafts them, so the
   * owner-scoped lookup above returns 404 for the employer — before row-level
   * security is even consulted. That would make "employer can view the full
   * commitment statement text in the portal before signing" impossible no
   * matter what the policies said.
   *
   * Reachability is the same as the RLS policy added in 1781100000024: the
   * caller must be the employer or provider organisation named on the
   * enrolment behind the statement. An unrelated organisation still gets 404.
   */
  async findStatementAsParty(
    user: AuthenticatedUser,
    id: string,
  ): Promise<CommitmentStatement> {
    const organisationId = user.organisationId!;

    const row = await this.statementRepo
      .createQueryBuilder('statement')
      .innerJoin(
        CommitmentStatementGroup,
        'grp',
        'grp.id = statement."groupId" AND grp."isDeleted" = false',
      )
      .innerJoin(
        Enrolment,
        'enrolment',
        'enrolment.id = grp."enrolmentId" AND enrolment."isDeleted" = false',
      )
      .where('statement.id = :id', { id })
      .andWhere(
        `(statement."organisationId" = :organisationId
          OR enrolment."employerOrganisationId" = :organisationId
          OR enrolment."providerOrganisationId" = :organisationId)`,
        { organisationId },
      )
      .getOne();

    if (!row) throw new NotFoundException('Commitment statement not found');
    return row;
  }

  /** Group lookup for any party, matching `findStatementAsParty`. */
  private async findGroupAsParty(
    user: AuthenticatedUser,
    groupId: string,
  ): Promise<CommitmentStatementGroup> {
    const organisationId = user.organisationId!;

    const group = await this.groupRepo
      .createQueryBuilder('grp')
      .innerJoin(
        Enrolment,
        'enrolment',
        'enrolment.id = grp."enrolmentId" AND enrolment."isDeleted" = false',
      )
      .where('grp.id = :groupId', { groupId })
      .andWhere('grp."isDeleted" = false')
      .andWhere(
        `(grp."organisationId" = :organisationId
          OR enrolment."employerOrganisationId" = :organisationId
          OR enrolment."providerOrganisationId" = :organisationId)`,
        { organisationId },
      )
      .getOne();

    if (!group) {
      throw new NotFoundException('Commitment statement group not found');
    }
    return group;
  }

  private async findGroup(
    user: AuthenticatedUser,
    groupId: string,
  ): Promise<CommitmentStatementGroup> {
    const group = await this.groupRepo.findOne({
      where: {
        id: groupId,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
    });
    if (!group)
      throw new NotFoundException('Commitment statement group not found');
    return group;
  }

  private async requireCurrentStatement(
    group: CommitmentStatementGroup,
  ): Promise<CommitmentStatement> {
    if (!group.currentVersionId) {
      throw new NotFoundException(
        'Commitment statement group has no current version',
      );
    }
    const current = await this.statementRepo.findOne({
      where: { id: group.currentVersionId },
    });
    if (!current) {
      throw new NotFoundException(
        'Current commitment statement version not found',
      );
    }
    return current;
  }

  private async assertEnrolmentMatch(
    organisationId: string,
    enrolmentId: string,
    apprenticeId: string,
  ): Promise<void> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new BadRequestException('Enrolment not found in this organisation');
    }
    if (enrolment.apprenticeId !== apprenticeId) {
      throw new BadRequestException(
        'Apprentice does not match the specified enrolment',
      );
    }
  }

  private isAdmin(user: AuthenticatedUser): boolean {
    const roles = user.roles ?? [];
    return (
      roles.includes(OrganisationRole.OWNER) ||
      roles.includes(OrganisationRole.ADMIN)
    );
  }

  toResponse(
    statement: CommitmentStatement,
    group: CommitmentStatementGroup,
  ): CommitmentStatementResponseDto {
    return {
      id: statement.id,
      groupId: statement.groupId,
      organisationId: statement.organisationId,
      enrolmentId: group.enrolmentId,
      apprenticeId: group.apprenticeId,
      version: statement.version,
      status: statement.status,
      content: statement.content as unknown as CommitmentStatementContentDto,
      apprenticeUserId: statement.apprenticeUserId,
      tutorUserId: statement.tutorUserId,
      employerManagerUserId: statement.employerManagerUserId,
      snapshotPdfJobId: statement.snapshotPdfJobId,
      finalSignedPdfKey: statement.finalSignedPdfKey,
      publishedAt: statement.publishedAt?.toISOString() ?? null,
      publishedByUserId: statement.publishedByUserId,
      supersededAt: statement.supersededAt?.toISOString() ?? null,
    };
  }
}
