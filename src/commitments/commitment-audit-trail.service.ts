import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { describeAuditEvent } from '../audit/audit-description.util.js';
import {
  AuditLogEntry,
  type AuditChanges,
} from '../audit/entities/audit-log-entry.entity.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { User } from '../users/entities/user.entity.js';

import { CommitmentStatementsService } from './commitment-statements.service.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';
import type { ICommitmentAuditTrailContent } from '../pdf/interfaces/pdf-renderer.interface.js';

/** Printed when a name or role is genuinely not held, rather than guessed. */
const NOT_RECORDED = 'Not recorded';

/** Keeps one pathological `changes` blob from producing a 40-page entry. */
const MAX_CHANGE_SUMMARY_LENGTH = 300;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'string') return value.length > 0 ? value : 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Symbols and functions cannot appear in a jsonb column, but `unknown`
  // does not know that; stringifying blind would print "[object Object]".
  return JSON.stringify(value) ?? 'empty';
}

/**
 * Turns `{"status":{"from":"draft","to":"published"}}` into
 * `status: draft → published`.
 *
 * The raw JSON is kept in the database and is still what the CSV export
 * gives an engineer. An Ofsted inspector reading a PDF should not have to
 * parse it.
 */
export function summariseChanges(changes: AuditChanges | null): string | null {
  if (!changes) return null;

  const parts: string[] = [];
  for (const [field, change] of Object.entries(changes)) {
    if (!change || typeof change !== 'object') continue;
    const hasFrom = 'from' in change;
    const hasTo = 'to' in change;
    if (!hasFrom && !hasTo) continue;

    if (hasFrom && hasTo) {
      parts.push(
        `${field}: ${formatValue(change.from)} → ${formatValue(change.to)}`,
      );
    } else if (hasTo) {
      parts.push(`${field}: ${formatValue(change.to)}`);
    } else {
      parts.push(`${field}: was ${formatValue(change.from)}`);
    }
  }

  if (parts.length === 0) return null;

  const summary = parts.join('; ');
  return summary.length > MAX_CHANGE_SUMMARY_LENGTH
    ? `${summary.slice(0, MAX_CHANGE_SUMMARY_LENGTH - 3)}...`
    : summary;
}

/**
 * F1.3.3 AC3 — assembles the audit trail for one commitment statement as an
 * Ofsted evidence document.
 *
 * Two things make this more than a filtered query.
 *
 * **The trail is spread across several entity ids.** A commitment statement
 * is a `commitment_statement_groups` row holding one
 * `commitment_statements` row per version, each with its own
 * `commitment_signatures` rows. Audit entries are filed against whichever of
 * those actually changed, so querying `entityId = statementId` returns the
 * entries for one version and silently omits every signature and every
 * earlier draft — a trail that looks complete and is not.
 *
 * **The entries belong to the provider's organisation.** They carry the
 * statement owner's `organisationId`, so an employer exporting the trail of
 * their own apprentice's statement would read zero rows under RLS. The
 * authorisation that matters is party membership, checked here, after which
 * the read runs under the bootstrap flag — the same reasoning as
 * `AuditEventService`, and the same owner-scoped-read trap that made the
 * signing endpoint 404.
 */
@Injectable()
export class CommitmentAuditTrailService {
  constructor(
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly groupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentSignature)
    private readonly signatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(AuditLogEntry)
    private readonly auditRepo: Repository<AuditLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly pdfDispatch: PdfDispatchService,
    private readonly statementsService: CommitmentStatementsService,
  ) {}

  /**
   * Enqueues the export.
   *
   * Asynchronous like every other PDF here — the caller polls
   * `GET /pdf/jobs/:jobId`. The party check runs now rather than only in the
   * worker so an employer asking for someone else's statement gets a 404 on
   * the request they made, not a job that fails silently a second later.
   */
  async requestExport(
    user: AuthenticatedUser,
    statementId: string,
  ): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    await this.statementsService.findStatementAsParty(user, statementId);

    const job = await this.pdfDispatch.enqueue({
      organisationId,
      userId: user.id,
      template: PdfJobTemplate.COMMITMENT_AUDIT_TRAIL,
      statementId,
    });

    return {
      jobId: job.id,
      status: job.status,
      template: job.template,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  async buildPdfContent(params: {
    organisationId: string;
    statementId: string;
    requestedByUserId: string;
  }): Promise<ICommitmentAuditTrailContent> {
    const { organisationId, statementId, requestedByUserId } = params;

    const statement = await this.statementRepo.findOne({
      where: { id: statementId },
    });
    if (!statement) {
      throw new NotFoundException('Commitment statement not found');
    }

    const group = await this.groupRepo.findOne({
      where: { id: statement.groupId, isDeleted: false },
      relations: ['apprentice'],
    });
    if (!group) {
      throw new NotFoundException('Commitment statement group not found');
    }

    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: group.enrolmentId, isDeleted: false },
    });

    /**
     * Re-checked here rather than trusted from the job payload. The endpoint
     * has already authorised the caller, but this method is what lifts the
     * RLS bootstrap flag — the check and the bypass belong together, or a
     * future caller enqueuing a job by statement id would read another
     * organisation's trail with nothing in the way.
     */
    const isParty =
      statement.organisationId === organisationId ||
      enrolment?.employerOrganisationId === organisationId ||
      enrolment?.providerOrganisationId === organisationId;
    if (!isParty) {
      throw new ForbiddenException('Not a party to this commitment statement');
    }

    const versions = await this.statementRepo.find({
      where: { groupId: group.id },
      order: { version: 'ASC' },
    });
    const statementIds = versions.map((v) => v.id);
    const signatures = statementIds.length
      ? await this.signatureRepo.find({
          where: { statementId: In(statementIds) },
        })
      : [];

    const entityIds = [
      group.id,
      ...statementIds,
      ...signatures.map((s) => s.id),
    ];
    const entries = await this.readTrail(entityIds);

    const [ownerOrg, employerOrg, providerOrg, requester] = await Promise.all([
      this.findOrganisationName(statement.organisationId),
      this.findOrganisationName(enrolment?.employerOrganisationId ?? null),
      this.findOrganisationName(enrolment?.providerOrganisationId ?? null),
      this.userRepo.findOne({ where: { id: requestedByUserId } }),
    ]);

    const current =
      versions.find((v) => v.id === group.currentVersionId) ?? statement;

    return {
      // The organisation the export was run by — the employer, when an
      // employer runs it, even though the entries are the provider's rows.
      organisationName:
        (organisationId === enrolment?.employerOrganisationId
          ? employerOrg
          : organisationId === enrolment?.providerOrganisationId
            ? providerOrg
            : ownerOrg) ?? 'Organisation',
      statementId: statement.id,
      currentVersion: current.version,
      status: current.status,
      apprenticeName: group.apprentice
        ? `${group.apprentice.firstName} ${group.apprentice.lastName}`
        : 'Apprentice',
      employerName: employerOrg,
      providerName: providerOrg,
      versions: versions.map((v) => ({
        version: v.version,
        statementId: v.id,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
        supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
      })),
      entries: entries.map((row) => ({
        at: row.createdAt.toISOString(),
        actorName: row.actorName ?? NOT_RECORDED,
        actorRole: row.actorRole ?? NOT_RECORDED,
        action: row.action,
        // Pre-AC2 entries have no stored description; derive one rather than
        // leaving a blank line where the event should be.
        description:
          row.description ?? describeAuditEvent(row.entityType, row.action),
        changeSummary: summariseChanges(row.changes),
      })),
      entryCount: entries.length,
      // The export covers the whole history of the record. Stated explicitly
      // so the document answers "is this all of it?" rather than implying it.
      rangeFrom: null,
      rangeTo: null,
      generatedAt: new Date().toISOString(),
      generatedByName: requester
        ? `${requester.firstName} ${requester.lastName}`
        : NOT_RECORDED,
    };
  }

  /**
   * Reads the entries under the RLS bootstrap flag.
   *
   * Restored in `finally`: leaving it set would let every later query in this
   * worker job read across organisations.
   */
  private async readTrail(entityIds: string[]): Promise<AuditLogEntry[]> {
    if (entityIds.length === 0) return [];

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return await this.auditRepo.find({
        where: { entityId: In(entityIds) },
        // Oldest first: evidence reads as a narrative, unlike the screens,
        // which want the most recent event at the top.
        order: { createdAt: 'ASC' },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async findOrganisationName(
    id: string | null,
  ): Promise<string | null> {
    if (!id) return null;
    const org = await this.organisationRepo.findOne({ where: { id } });
    return org?.name ?? null;
  }
}
