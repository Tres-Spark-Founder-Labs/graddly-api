import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import {
  CommitmentBoardResponseDto,
  CommitmentBoardRowDto,
  CommitmentPartyStatus,
} from './dto/commitment-board-row.dto.js';
import { CommitmentVersionHistoryResponseDto } from './dto/commitment-version-history.dto.js';
import { ListCommitmentBoardQueryDto } from './dto/list-commitment-board-query.dto.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F1.3.1 — the employer's commitment statement status board.
 *
 * This is a separate read model rather than an extension of
 * `CommitmentStatementsService.findAll`, for two reasons. That method scopes
 * on `statement.organisationId`, which is the *provider* — commitment
 * statements are drafted by the provider, so an employer querying it gets
 * nothing back regardless of row-level security. And the board needs a
 * different shape: one row per apprentice carrying three signature states and
 * names resolved from four other tables, not a page of statement records.
 *
 * Scoping is by `enrolment.employerOrganisationId`, which is what makes the
 * employer a party. Migration 1781100000024 opened the matching row-level
 * security policies; without both, this returns an empty board.
 */
@Injectable()
export class CommitmentBoardService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly groupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentSignature)
    private readonly signatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getBoard(
    user: AuthenticatedUser,
    query: ListCommitmentBoardQueryDto = {},
  ): Promise<CommitmentBoardResponseDto> {
    const organisationId = user.organisationId!;

    const enrolments = await this.enrolmentRepo.find({
      where: { employerOrganisationId: organisationId, isDeleted: false },
    });
    if (enrolments.length === 0) {
      return { rows: [], actionRequiredCount: 0, total: 0 };
    }

    const enrolmentById = new Map(enrolments.map((e) => [e.id, e]));

    const groups = await this.groupRepo.find({
      where: { enrolmentId: In([...enrolmentById.keys()]), isDeleted: false },
    });
    if (groups.length === 0) {
      return { rows: [], actionRequiredCount: 0, total: 0 };
    }

    const statements = await this.statementRepo.find({
      where: { groupId: In(groups.map((g) => g.id)) },
      order: { version: 'DESC' },
    });

    /**
     * One row per apprentice, showing the current version.
     *
     * Statements are versioned and superseded rather than edited, so a group
     * accumulates history. The board shows the live one; F1.3.2 AC5 covers
     * the version history behind it. Ordering by version descending above
     * means the first statement seen for a group is the newest.
     */
    const latestByGroup = new Map<string, CommitmentStatement>();
    for (const statement of statements) {
      if (!latestByGroup.has(statement.groupId)) {
        latestByGroup.set(statement.groupId, statement);
      }
    }

    const liveStatements = [...latestByGroup.values()];
    const signatures = await this.signatureRepo.find({
      where: { statementId: In(liveStatements.map((s) => s.id)) },
    });

    const signaturesByStatement = new Map<string, CommitmentSignature[]>();
    for (const signature of signatures) {
      const bucket = signaturesByStatement.get(signature.statementId) ?? [];
      bucket.push(signature);
      signaturesByStatement.set(signature.statementId, bucket);
    }

    const groupById = new Map(groups.map((g) => [g.id, g]));
    const [apprenticeNames, providerNames, standardNames] = await Promise.all([
      this.loadApprenticeNames(groups.map((g) => g.apprenticeId)),
      this.loadOrganisationNames(
        enrolments
          .map((e) => e.providerOrganisationId)
          .filter((id): id is string => !!id),
      ),
      this.loadStandardNames(enrolments.map((e) => e.standardId)),
    ]);

    const allRows = liveStatements.map((statement) => {
      const group = groupById.get(statement.groupId)!;
      const enrolment = enrolmentById.get(group.enrolmentId)!;
      const rowSignatures = signaturesByStatement.get(statement.id) ?? [];

      return {
        statementId: statement.id,
        enrolmentId: enrolment.id,
        apprenticeId: group.apprenticeId,
        apprenticeName: apprenticeNames.get(group.apprenticeId) ?? null,
        providerName: enrolment.providerOrganisationId
          ? (providerNames.get(enrolment.providerOrganisationId) ?? null)
          : null,
        providerOrganisationId: enrolment.providerOrganisationId,
        standardName: standardNames.get(enrolment.standardId) ?? null,
        standardId: enrolment.standardId,
        version: statement.version,
        statementStatus: statement.status,
        employerStatus: this.partyStatus(
          rowSignatures,
          TripartiteParty.EMPLOYER_MANAGER,
        ),
        apprenticeStatus: this.partyStatus(
          rowSignatures,
          TripartiteParty.APPRENTICE,
        ),
        providerStatus: this.partyStatus(rowSignatures, TripartiteParty.TUTOR),
        actionRequired: this.employerCanSignNow(rowSignatures),
        publishedAt: statement.publishedAt
          ? new Date(statement.publishedAt).toISOString()
          : null,
        finalSignedPdfKey: statement.finalSignedPdfKey,
      } satisfies CommitmentBoardRowDto;
    });

    // AC5 — counted before filtering. A badge that changed when you filtered
    // the table would be answering a different question from the one asked.
    const actionRequiredCount = allRows.filter((r) => r.actionRequired).length;

    const rows = this.sortActionFirst(this.applyFilters(allRows, query));

    return { rows, actionRequiredCount, total: allRows.length };
  }

  /**
   * F1.3.2 AC5 — "version history shows all prior versions with dates and
   * signatories".
   *
   * Resolved for any party to the enrolment, not just the statement owner,
   * for the same reason as the board: the provider drafts the statement, so
   * an owner-scoped query returns nothing for the employer reading their own
   * signing history.
   *
   * Signatory *names* are resolved here rather than left as user ids —
   * "who signed this, and when" is the whole point of the panel, and an id
   * answers neither question.
   */
  async getVersionHistory(
    user: AuthenticatedUser,
    groupId: string,
  ): Promise<CommitmentVersionHistoryResponseDto> {
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

    const statements = await this.statementRepo.find({
      where: { groupId },
      order: { version: 'DESC' },
    });
    if (statements.length === 0) {
      return { groupId, versions: [] };
    }

    const signatures = await this.signatureRepo.find({
      where: { statementId: In(statements.map((s) => s.id)) },
    });

    const signerNames = await this.loadUserNames(
      signatures.map((s) => s.signerUserId),
    );

    const byStatement = new Map<string, CommitmentSignature[]>();
    for (const signature of signatures) {
      const bucket = byStatement.get(signature.statementId) ?? [];
      bucket.push(signature);
      byStatement.set(signature.statementId, bucket);
    }

    const versions = statements.map((statement) => ({
      statementId: statement.id,
      version: statement.version,
      status: statement.status,
      publishedAt: statement.publishedAt
        ? new Date(statement.publishedAt).toISOString()
        : null,
      supersededAt: statement.supersededAt
        ? new Date(statement.supersededAt).toISOString()
        : null,
      finalSignedPdfKey: statement.finalSignedPdfKey,
      signatories: (byStatement.get(statement.id) ?? [])
        .sort((a, b) => a.signOrder - b.signOrder)
        .map((s) => ({
          party: s.party,
          name: signerNames.get(s.signerUserId) ?? null,
          signed: s.status === CommitmentSignatureStatus.SIGNED,
          // `updatedAt` is when the row last changed, which for a signed
          // signature is when it was signed. The signature record holds the
          // authoritative timestamp; this is the cheap read for a list.
          signedAt:
            s.status === CommitmentSignatureStatus.SIGNED && s.updatedAt
              ? new Date(s.updatedAt).toISOString()
              : null,
        })),
    }));

    return { groupId, versions };
  }

  private async loadUserNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Map();
    const rows = await this.userRepo.find({
      where: { id: In(unique), isDeleted: false },
      select: ['id', 'firstName', 'lastName', 'email'],
    });
    return new Map(
      rows.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
      ]),
    );
  }

  /** AC2 — a missing signature row means the statement has not been sent. */
  private partyStatus(
    signatures: CommitmentSignature[],
    party: TripartiteParty,
  ): CommitmentPartyStatus {
    const signature = signatures.find((s) => s.party === party);
    if (!signature) return CommitmentPartyStatus.NOT_SENT;
    return signature.status === CommitmentSignatureStatus.SIGNED
      ? CommitmentPartyStatus.SIGNED
      : CommitmentPartyStatus.PENDING;
  }

  /**
   * AC3 — whether the employer is the one being waited on.
   *
   * Signing is sequential: `commitment-chase.service.ts` only ever chases the
   * lowest unsigned `signOrder`, and the sign endpoint rejects an out-of-turn
   * attempt. So "requires employer signature" has to mean the employer is
   * *next*, not merely unsigned — otherwise the top of the board would fill
   * with statements the employer is not yet allowed to sign.
   */
  private employerCanSignNow(signatures: CommitmentSignature[]): boolean {
    const employer = signatures.find(
      (s) => s.party === TripartiteParty.EMPLOYER_MANAGER,
    );
    if (!employer || employer.status === CommitmentSignatureStatus.SIGNED) {
      return false;
    }
    return signatures
      .filter((s) => s.signOrder < employer.signOrder)
      .every((s) => s.status === CommitmentSignatureStatus.SIGNED);
  }

  private applyFilters(
    rows: CommitmentBoardRowDto[],
    query: ListCommitmentBoardQueryDto,
  ): CommitmentBoardRowDto[] {
    return rows.filter((row) => {
      if (query.status && row.statementStatus !== query.status) return false;
      if (
        query.providerOrganisationId &&
        row.providerOrganisationId !== query.providerOrganisationId
      ) {
        return false;
      }
      if (query.standardId && row.standardId !== query.standardId) return false;
      if (query.actionRequiredOnly && !row.actionRequired) return false;
      return true;
    });
  }

  /**
   * AC3 — statements awaiting the employer come first. Within each block the
   * oldest published statement leads, so the longest wait is dealt with first
   * rather than the most recent.
   */
  private sortActionFirst(
    rows: CommitmentBoardRowDto[],
  ): CommitmentBoardRowDto[] {
    return [...rows].sort((a, b) => {
      if (a.actionRequired !== b.actionRequired) {
        return a.actionRequired ? -1 : 1;
      }
      const aTime = a.publishedAt ? Date.parse(a.publishedAt) : Infinity;
      const bTime = b.publishedAt ? Date.parse(b.publishedAt) : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      return (a.apprenticeName ?? '').localeCompare(b.apprenticeName ?? '');
    });
  }

  private async loadApprenticeNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.apprenticeRepo.find({
      where: { id: In(unique), isDeleted: false },
      select: ['id', 'firstName', 'lastName'],
    });
    return new Map(
      rows.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim()]),
    );
  }

  private async loadOrganisationNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.organisationRepo.find({
      where: { id: In(unique), isDeleted: false },
      select: ['id', 'name'],
    });
    return new Map(rows.map((o) => [o.id, o.name]));
  }

  private async loadStandardNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.standardRepo.find({
      where: { id: In(unique), isDeleted: false },
      select: ['id', 'title'],
    });
    return new Map(rows.map((s) => [s.id, s.title]));
  }
}
