import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type {
  ICommitmentAuditTrailContent,
  ICommitmentSnapshotContent,
  ILevyRoiReportContent,
  ILevyTransferAgreementContent,
  IPdfRenderer,
  IProviderComparisonContent,
  ILearnerCohortContent,
  IQipPlanContent,
  IReviewSnapshotContent,
  ISignedPdfOptions,
} from '../interfaces/pdf-renderer.interface.js';

/**
 * Reads as prose in the signed record; the stored value would not.
 *
 * A switch rather than a lookup map so the renderer does not import an enum
 * from the reviews module — the PDF layer renders content it is handed and
 * should not depend on the feature that produced it.
 */
function previousGoalOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'achieved':
      return 'Achieved';
    case 'partially_achieved':
      return 'Partially achieved';
    case 'not_achieved':
      return 'Not achieved';
    case 'carried_forward':
      return 'Carried forward to this review';
    default:
      return outcome;
  }
}

function isPng(buffer: Buffer): boolean {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return (
    buffer.length >= signature.length && buffer.subarray(0, 8).equals(signature)
  );
}

function renderToBuffer(
  build: (doc: InstanceType<typeof PDFDocument>) => void,
  options: { layout?: 'portrait' | 'landscape' } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, layout: options.layout });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

@Injectable()
export class PdfKitPdfRenderer implements IPdfRenderer {
  renderHelloPdf(): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc.fontSize(24).text('Hello from Graddly PDF', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text('Phase J pdfkit baseline', { align: 'center' });
    });
  }

  renderCommitmentSnapshot(
    content: ICommitmentSnapshotContent,
  ): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc.fontSize(20).text('Commitment statement', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Apprentice: ${content.apprenticeName}`);
      doc.text(`Version: ${content.version}`);
      doc.moveDown().fontSize(14).text('Training plan summary');
      doc.fontSize(11).text(content.trainingPlanSummary);
      doc.moveDown().fontSize(14).text('Employer commitments');
      doc.fontSize(11).text(content.employerCommitments);
      doc.moveDown().fontSize(14).text('Apprentice commitments');
      doc.fontSize(11).text(content.apprenticeCommitments);
      doc.moveDown().fontSize(14).text('Provider commitments');
      doc.fontSize(11).text(content.providerCommitments);
      if (content.weeklyHours !== undefined) {
        doc
          .moveDown()
          .fontSize(11)
          .text(`Weekly hours: ${content.weeklyHours}`);
      }
      if (content.additionalTerms) {
        doc.moveDown().fontSize(14).text('Additional terms');
        doc.fontSize(11).text(content.additionalTerms);
      }
    });
  }

  renderLevyTransferAgreement(
    content: ILevyTransferAgreementContent,
  ): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc.fontSize(20).text('Levy transfer agreement', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Donor: ${content.donorOrganisationName}`);
      doc.text(`Recipient: ${content.recipientOrganisationName}`);
      doc.text(`Amount: GBP ${content.amount}`);
      if (content.startDate) {
        doc.text(`Start date: ${content.startDate}`);
      }
      if (content.programmeDetails) {
        doc.moveDown().fontSize(14).text('Programme details');
        doc
          .fontSize(11)
          .text(JSON.stringify(content.programmeDetails, null, 2));
      }
    });
  }

  renderReviewSnapshot(content: IReviewSnapshotContent): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc.fontSize(20).text(content.title ?? 'Apprenticeship review', {
        align: 'center',
      });
      doc.moveDown();
      doc.fontSize(12).text(`Apprentice: ${content.apprenticeName}`);
      doc.text(`Scheduled: ${content.scheduledAt}`);
      if (content.progressSummary) {
        doc.moveDown().fontSize(14).text('Progress summary');
        doc.fontSize(11).text(content.progressSummary);
      }
      if (content.actionsAgreed) {
        doc.moveDown().fontSize(14).text('Actions agreed');
        doc.fontSize(11).text(content.actionsAgreed);
      }
      if (content.employerComments) {
        doc.moveDown().fontSize(14).text('Employer comments');
        doc.fontSize(11).text(content.employerComments);
      }
      /**
       * F2.2.3 AC4 — placed before this review's new goals, because that is
       * the order the conversation happens in: what did we agree last time,
       * did it happen, what next.
       */
      if (content.previousGoalProgress?.length) {
        doc.moveDown().fontSize(14).text('Progress against previous goals');
        for (const item of content.previousGoalProgress) {
          doc.moveDown(0.5).fontSize(11).text(`• ${item.objective}`);
          doc
            .fontSize(10)
            .fillColor('#666666')
            .text(`   ${previousGoalOutcomeLabel(item.outcome)}`)
            .fillColor('black');
          if (item.notes) {
            doc.fontSize(10).text(`   ${item.notes}`);
          }
        }
      }

      if (content.otjDiscussion) {
        doc.moveDown().fontSize(14).text('Off-the-job hours discussion');
        doc.fontSize(11).text(content.otjDiscussion);
      }

      if (content.smartGoals?.length) {
        doc.moveDown().fontSize(14).text('SMART goals');
        for (const goal of content.smartGoals) {
          doc.moveDown().fontSize(11).text(`• ${goal.objective}`);
        }
      }
      if (content.wellbeingScore !== undefined || content.wellbeingNotes) {
        doc.moveDown().fontSize(14).text('Wellbeing');
        if (content.wellbeingScore !== undefined) {
          doc.fontSize(11).text(`Score: ${content.wellbeingScore}/10`);
        }
        if (content.wellbeingNotes) {
          doc.fontSize(11).text(content.wellbeingNotes);
        }
      }
    });
  }

  renderLevyRoiReport(content: ILevyRoiReportContent): Promise<Buffer> {
    return renderToBuffer((doc) => {
      // F1.1.5 AC2 — branded with Gradlly and the employer's name/logo.
      if (content.logoBytes) {
        try {
          doc.image(content.logoBytes, { fit: [140, 48], align: 'center' });
          doc.moveDown(0.5);
        } catch {
          // An unreadable or unsupported image must not fail the whole report.
        }
      }
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text('Gradlly', { align: 'center' })
        .fillColor('black');
      doc.moveDown(0.5);
      doc.fontSize(22).text('Levy Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text(content.organisationName, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Generated: ${content.generatedAt.slice(0, 10)}`);

      doc.moveDown().fontSize(16).text('Summary');
      const summary = content.summary;
      doc.fontSize(11);
      doc.text(`Total levy spend (proxy): GBP ${summary.totalLevySpendToDate}`);
      doc.text(
        `Available balance: ${summary.availableBalance ?? 'n/a'} ${summary.currency ?? ''}`.trim(),
      );
      if (summary.utilisationPercent !== null) {
        doc.text(`Utilisation: ${summary.utilisationPercent}%`);
      }
      doc.text(`Active apprentices: ${summary.activeApprenticeCount}`);
      doc.text(`Completions: ${summary.completionCount}`);
      if (summary.averageCostPerCompletion !== null) {
        doc.text(
          `Average cost per completion: GBP ${summary.averageCostPerCompletion}`,
        );
      }
      /**
       * F1.4.1 AC1. Reported with its denominator: a 100% pass rate from two
       * apprentices and one from forty are different facts, and a board paper
       * that prints only "100%" invites the wrong conclusion. "Not yet
       * assessed" is stated rather than shown as 0%.
       */
      doc.text(
        summary.epaPassRate === null
          ? 'EPA pass rate: no apprentices assessed yet'
          : `EPA pass rate: ${summary.epaPassRate}%` +
              (summary.epaAssessedCount
                ? ` (${summary.epaAssessedCount} assessed)`
                : ''),
      );
      doc.text(
        `Estimated productivity uplift: GBP ${summary.estimatedProductivityUplift}`,
      );

      doc.moveDown().fontSize(16).text('Monthly contributions');
      if (summary.monthlyContributions.length === 0) {
        doc.fontSize(11).text('Contribution history not yet available.');
      } else {
        for (const row of summary.monthlyContributions) {
          doc.fontSize(11).text(`${row.month}: GBP ${row.amount}`);
        }
      }

      if (summary.utilisationSegments) {
        doc.moveDown().fontSize(16).text('Utilisation segments');
        const segments = summary.utilisationSegments;
        doc.fontSize(11);
        doc.text(`Used: ${segments.currency} ${segments.used}`);
        doc.text(
          `Expiring within 90 days: ${segments.currency} ${segments.expiringWithin90Days}`,
        );
        doc.text(`Available: ${segments.currency} ${segments.available}`);
      }

      // F1.1.5 AC1 — forward forecast. Omitted entirely when unavailable
      // rather than printing zeros, which would read as a real projection.
      if (content.forecast) {
        const forecast = content.forecast;
        doc.moveDown().fontSize(16).text('Forecast');
        doc.fontSize(11);
        doc.text(
          `Projected spend (next ${forecast.horizonMonths} months): GBP ${
            forecast.projectedMonthlySpend * forecast.horizonMonths
          }`,
        );
        doc.text(`Monthly run rate: GBP ${forecast.projectedMonthlySpend}`);
        doc.text(`Active programmes: ${forecast.activeEnrolmentCount}`);
        doc.text(
          `Projected completion liability: GBP ${forecast.projectedCompletionLiability}`,
        );
        doc.text(
          `Estimated runway: ${
            forecast.estimatedRunwayMonths === null
              ? 'n/a (no projected spend)'
              : `${forecast.estimatedRunwayMonths} months`
          }`,
        );
      }

      /**
       * F1.4.1 AC3 — year-on-year, printed before the breakdowns because it
       * is the movement a board reads first.
       */
      if (content.yearOnYear) {
        const yoy = content.yearOnYear;
        doc.moveDown().fontSize(16).text('Year on year');
        doc.fontSize(11);

        if (!yoy.hasPriorPeriodData || !yoy.priorPeriod) {
          doc.text(
            'No prior-year data available for comparison. This is the first ' +
              'reporting period with recorded activity.',
          );
        } else {
          const prior = yoy.priorPeriod;
          const current = yoy.currentPeriod;
          const delta = (value: number | null, suffix = '%') =>
            value === null ? 'n/a' : `${value > 0 ? '+' : ''}${value}${suffix}`;

          doc.text(`This period:  ${current.label}`);
          doc.text(`Prior period: ${prior.label}`);
          doc.moveDown(0.3);
          doc.text(
            `Starts: ${current.starts} vs ${prior.starts} (${delta(yoy.startsChangePercent)})`,
          );
          doc.text(
            `Completions: ${current.completions} vs ${prior.completions} (${delta(yoy.completionsChangePercent)})`,
          );
          doc.text(
            `Withdrawals: ${current.withdrawals} vs ${prior.withdrawals}`,
          );
          doc.text(
            `Levy spend: GBP ${current.levySpend} vs GBP ${prior.levySpend} (${delta(yoy.levySpendChangePercent)})`,
          );
          doc.text(
            `EPA pass rate: ${current.epaPassRate ?? 'n/a'} vs ${prior.epaPassRate ?? 'n/a'}` +
              (yoy.epaPassRatePointChange === null
                ? ''
                : ` (${delta(yoy.epaPassRatePointChange, ' pts')})`),
          );
        }
      }

      const renderBreakdownTable = (
        title: string,
        rows: ILevyRoiReportContent['breakdownByProvider'],
      ) => {
        doc.moveDown().fontSize(16).text(title);
        if (rows.length === 0) {
          doc.fontSize(11).text('No data.');
          return;
        }
        for (const row of rows) {
          // AC2 — outcomes side by side, not just volumes. Without the pass
          // rate and withdrawal rate this compares how *many* apprentices
          // each provider has, not how well they do.
          const epa =
            row.epaPassRate === null || row.epaPassRate === undefined
              ? 'EPA n/a'
              : `EPA ${row.epaPassRate}%${row.epaAssessedCount ? ` (${row.epaAssessedCount})` : ''}`;
          const withdrawals =
            row.withdrawalRate === null || row.withdrawalRate === undefined
              ? ''
              : `, withdrawn ${row.withdrawalRate}%`;
          doc
            .fontSize(11)
            .text(
              `${row.label}: active ${row.activeApprenticeCount}, completed ${row.completionCount}, ` +
                `avg cost ${row.averageCostPerCompletion ?? 'n/a'}, ${epa}${withdrawals}`,
            );
        }
      };

      renderBreakdownTable(
        'Breakdown by provider',
        content.breakdownByProvider,
      );
      renderBreakdownTable(
        'Breakdown by standard',
        content.breakdownByStandard,
      );

      doc
        .moveDown()
        .fontSize(9)
        .text('Graddly — board-ready levy report export', {
          align: 'center',
        });
    });
  }

  /**
   * F1.3.3 AC3 — the audit trail as an Ofsted evidence document.
   *
   * Laid out as a chronological record rather than a table of columns: each
   * entry is a short paragraph headed by its UTC timestamp, because a reader
   * scanning for "when was this signed and by whom" should not have to align
   * columns across a page break. Entries are printed oldest-first — the API
   * serves newest-first for screens, but evidence reads as a narrative.
   */
  renderCommitmentAuditTrail(
    content: ICommitmentAuditTrailContent,
  ): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text('Gradlly', { align: 'center' })
        .fillColor('black');
      doc.moveDown(0.5);
      doc
        .fontSize(20)
        .text('Commitment statement audit trail', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(content.organisationName, { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text('Record');
      doc.fontSize(11);
      doc.text(`Apprentice: ${content.apprenticeName}`);
      doc.text(`Employer: ${content.employerName ?? 'Not recorded'}`);
      doc.text(`Training provider: ${content.providerName ?? 'Not recorded'}`);
      doc.text(`Statement reference: ${content.statementId}`);
      doc.text(`Current version: ${content.currentVersion}`);
      doc.text(`Current status: ${content.status}`);

      doc.moveDown().fontSize(14).text('Versions');
      doc.fontSize(11);
      if (content.versions.length === 0) {
        doc.text('No versions recorded.');
      } else {
        for (const version of content.versions) {
          const superseded = version.supersededAt
            ? `, superseded ${version.supersededAt}`
            : '';
          doc.text(
            `v${version.version} — ${version.status}, created ${version.createdAt}${superseded}`,
          );
        }
      }

      doc.moveDown().fontSize(14).text('Audit trail');
      doc.fontSize(10).fillColor('#666666');
      const scope =
        content.rangeFrom || content.rangeTo
          ? `${content.rangeFrom ?? 'the beginning'} to ${content.rangeTo ?? 'now'}`
          : 'the full history of this record';
      doc.text(`${content.entryCount} entries covering ${scope}.`);
      doc.fillColor('black');
      doc.moveDown(0.5);

      if (content.entries.length === 0) {
        doc.fontSize(11).text('No audit entries recorded for this statement.');
      } else {
        for (const entry of content.entries) {
          doc.fontSize(10).fillColor('#666666').text(entry.at);
          doc.fillColor('black').fontSize(11).text(entry.description);
          doc.fontSize(10).text(`${entry.actorName} — ${entry.actorRole}`);
          if (entry.changeSummary) {
            doc.fontSize(9).fillColor('#444444').text(entry.changeSummary);
            doc.fillColor('black');
          }
          doc.moveDown(0.5);
        }
      }

      doc.moveDown();
      doc.fontSize(9).fillColor('#666666');
      doc.text(
        `Generated ${content.generatedAt} by ${content.generatedByName}.`,
        { align: 'center' },
      );
      // Stated in the document because an inspector reading a PDF cannot see
      // the database trigger that makes it true.
      doc.text(
        'Audit entries are protected against modification and deletion at the database level.',
        { align: 'center' },
      );
      doc.fillColor('black');
    });
  }

  /**
   * F1.4.2 AC3 — the provider comparison as a standalone document.
   *
   * Laid out as a real table with fixed columns rather than the run-on text
   * lines the levy report uses for its breakdown: the whole point of this
   * page is reading *across* providers, which needs the numbers to line up.
   */
  renderProviderComparison(
    content: IProviderComparisonContent,
  ): Promise<Buffer> {
    return renderToBuffer((doc) => {
      if (content.logoBytes) {
        try {
          doc.image(content.logoBytes, { fit: [140, 48], align: 'center' });
          doc.moveDown(0.5);
        } catch {
          // A bad logo must not fail the report.
        }
      }
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text('Gradlly', { align: 'center' })
        .fillColor('black');
      doc.moveDown(0.5);
      doc.fontSize(20).text('Provider performance', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(content.organisationName, { align: 'center' });
      doc.moveDown();

      // AC2, stated on the document. A comparison whose provenance is
      // unclear invites "our figures say otherwise" in the meeting it is
      // taken into.
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text(
          'All figures are calculated from live platform data — apprentice ' +
            'off-the-job logs, scheduled reviews, recorded EPA outcomes and ' +
            'enrolment status. None are self-reported by providers.',
          { align: 'center' },
        )
        .fillColor('black');
      doc.moveDown();

      if (content.rows.length === 0) {
        doc
          .fontSize(11)
          .text(
            'No linked providers with active or completed apprentices yet.',
          );
      } else {
        const columns = [
          { key: 'label', label: 'Provider', width: 150 },
          { key: 'activeApprenticeCount', label: 'Active', width: 45 },
          { key: 'averageOtjPercent', label: 'OTJ %', width: 55 },
          { key: 'reviewComplianceRate', label: 'Reviews', width: 55 },
          { key: 'epaPassRate', label: 'EPA %', width: 55 },
          { key: 'withdrawalRate', label: 'Withdrawn', width: 65 },
        ] as const;

        const startX = doc.page.margins.left;
        let y = doc.y;

        doc.fontSize(9).fillColor('#666666');
        let x = startX;
        for (const column of columns) {
          doc.text(column.label, x, y, { width: column.width });
          x += column.width;
        }
        doc.fillColor('black');
        y += 16;
        doc
          .moveTo(startX, y - 4)
          .lineTo(startX + 425, y - 4)
          .strokeColor('#dddddd')
          .stroke();

        doc.fontSize(10);
        for (const row of content.rows) {
          // "—" rather than 0 for an unmeasurable metric: a provider with no
          // reviews due yet has not scored zero on review compliance.
          const cells = [
            row.label,
            String(row.activeApprenticeCount),
            row.averageOtjPercent === null ? '—' : `${row.averageOtjPercent}%`,
            row.reviewComplianceRate === null
              ? '—'
              : `${row.reviewComplianceRate}%`,
            row.epaPassRate === null
              ? '—'
              : `${row.epaPassRate}% (${row.epaAssessedCount})`,
            row.withdrawalRate === null ? '—' : `${row.withdrawalRate}%`,
          ];

          x = startX;
          for (const [index, column] of columns.entries()) {
            doc.text(cells[index], x, y, {
              width: column.width,
              lineBreak: false,
            });
            x += column.width;
          }
          y += 18;

          // Start a new page before running off the bottom.
          if (y > doc.page.height - doc.page.margins.bottom - 40) {
            doc.addPage();
            y = doc.page.margins.top;
          }
        }
        doc.y = y;
      }

      doc.moveDown(1.5);
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text(
          'EPA pass rate counts pass, merit and distinction, with the number ' +
            'assessed in brackets. A dash means the metric cannot be ' +
            'calculated yet, not zero.',
          doc.page.margins.left,
          doc.y,
        )
        .text(`Generated ${content.generatedAt.slice(0, 10)}.`)
        .fillColor('black');
    });
  }

  /**
   * F2.1.2 AC5 — the Quality Improvement Plan as an inspection document.
   *
   * Grouped by EIF criterion because that is the unit an inspector works in:
   * they ask "what are you doing about personal development?", not "show me
   * action 14". A flat chronological list is how the plan is *managed*; this
   * is how it is *read*.
   */
  renderQipPlan(content: IQipPlanContent): Promise<Buffer> {
    return renderToBuffer((doc) => {
      if (content.logoBytes) {
        try {
          doc.image(content.logoBytes, { fit: [140, 48], align: 'center' });
          doc.moveDown(0.5);
        } catch {
          // A bad logo must not fail the plan.
        }
      }
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text('Gradlly', { align: 'center' })
        .fillColor('black');
      doc.moveDown(0.5);
      doc.fontSize(20).text('Quality Improvement Plan', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(content.organisationName, { align: 'center' });
      doc.moveDown();

      // Progress first. An inspector's opening question about a QIP is how
      // much of it has actually been done.
      doc.fontSize(14).text('Progress');
      doc.fontSize(11);
      doc.text(
        `${content.completed} of ${content.total} actions complete (${content.percentComplete}%).`,
      );
      if (content.overdue > 0) {
        doc
          .fillColor('#c0392b')
          .text(
            `${content.overdue} action${content.overdue === 1 ? '' : 's'} past target date.`,
          )
          .fillColor('black');
      } else {
        doc.text('No actions are past their target date.');
      }

      if (content.groups.length === 0) {
        doc.moveDown().fontSize(11).text('No actions have been recorded yet.');
      }

      for (const group of content.groups) {
        doc.moveDown().fontSize(14).text(group.label);
        doc
          .fontSize(9)
          .fillColor('#666666')
          .text(`EIF criterion: ${group.slug}`)
          .fillColor('black');
        doc.moveDown(0.3);

        for (const action of group.actions) {
          // Start a new page rather than splitting an action across the
          // boundary — a target date orphaned from its title is unreadable.
          if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
            doc.addPage();
          }

          doc.fontSize(11).text(action.title, { continued: false });
          doc.fontSize(9).fillColor('#666666');
          doc.text(
            `Owner: ${action.ownerName}   Target: ${action.targetCompletionDate}   Status: ${action.status}`,
          );
          if (action.isOverdue) {
            doc.fillColor('#c0392b').text('OVERDUE').fillColor('#666666');
          }
          if (action.description) {
            doc.fillColor('black').fontSize(10).text(action.description);
            doc.fontSize(9).fillColor('#666666');
          }
          if (action.evidenceNotes) {
            doc.text(`Evidence: ${action.evidenceNotes}`);
          }
          if (action.evidenceAttachmentCount > 0) {
            // Counted rather than embedded: the documents live in the
            // evidence pack (F2.1.4), and duplicating them here would make
            // two versions of the same evidence with no way to tell which an
            // inspector was shown.
            doc.text(
              `${action.evidenceAttachmentCount} supporting document${
                action.evidenceAttachmentCount === 1 ? '' : 's'
              } attached — included in the Ofsted evidence pack.`,
            );
          }
          doc.fillColor('black');
          doc.moveDown(0.5);
        }
      }

      doc.moveDown();
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text(
          `Generated ${content.generatedAt.slice(0, 10)} by ${content.generatedByName}.`,
          { align: 'center' },
        )
        .fillColor('black');
    });
  }

  /**
   * F2.2.1 AC5 — the cohort table as a PDF.
   *
   * Landscape, because the criterion names nine columns and portrait A4
   * cannot carry them without truncating learner names — and a cohort list
   * where you cannot tell two learners apart is not a cohort list.
   */
  renderLearnerCohort(content: ILearnerCohortContent): Promise<Buffer> {
    return renderToBuffer(
      (doc) => {
        if (content.logoBytes) {
          try {
            doc.image(content.logoBytes, { fit: [140, 48], align: 'center' });
            doc.moveDown(0.5);
          } catch {
            // A bad logo must not fail the export.
          }
        }
        doc
          .fontSize(9)
          .fillColor('#666666')
          .text('Gradlly', { align: 'center' })
          .fillColor('black');
        doc.moveDown(0.5);
        doc.fontSize(18).text('Learner cohort', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(11).text(content.organisationName, { align: 'center' });
        doc.moveDown(0.5);

        /**
         * The filters, on the face of the document. A printed cohort table with
         * no record of what it was filtered to is a page of numbers nobody in
         * the room can check — and the reader is not the person who applied
         * them.
         */
        doc.fontSize(9).fillColor('#666666');
        doc.text(
          content.filterSummary
            ? `Filtered: ${content.filterSummary}`
            : 'No filters applied — every learner in the organisation.',
          { align: 'center' },
        );
        doc.text(`${content.totalCount} learners.`, { align: 'center' });
        if (content.statusCounts.length > 0) {
          doc.text(
            content.statusCounts
              .map((s) => `${s.label}: ${s.count}`)
              .join('   '),
            { align: 'center' },
          );
        }
        doc.fillColor('black');
        doc.moveDown();

        if (content.rows.length === 0) {
          doc.fontSize(11).text('No learners match these filters.');
        } else {
          const columns = [
            { label: 'Learner', width: 105 },
            { label: 'Employer', width: 95 },
            { label: 'Standard', width: 110 },
            { label: 'Start', width: 58 },
            { label: 'OTJ %', width: 42 },
            { label: 'Next review', width: 62 },
            { label: 'EPA', width: 58 },
            { label: 'Status', width: 72 },
            { label: 'Tutor', width: 80 },
          ] as const;
          const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

          const startX = doc.page.margins.left;
          let y = doc.y;

          const drawHeader = () => {
            doc.fontSize(8).fillColor('#666666');
            let x = startX;
            for (const column of columns) {
              doc.text(column.label, x, y, {
                width: column.width,
                lineBreak: false,
              });
              x += column.width;
            }
            doc.fillColor('black');
            y += 14;
            doc
              .moveTo(startX, y - 4)
              .lineTo(startX + tableWidth, y - 4)
              .strokeColor('#dddddd')
              .stroke();
            doc.fontSize(9);
          };

          drawHeader();

          for (const row of content.rows) {
            // "—" rather than 0 or a blank: an apprentice with no logged hours
            // has not achieved 0% off-the-job, and a blank cell reads as a bug.
            const cells = [
              row.learnerName,
              row.employerName ?? '—',
              row.standardTitle,
              row.startDate ?? '—',
              row.otjPercent === null ? '—' : `${row.otjPercent}%`,
              row.nextReviewDate ?? '—',
              row.epaDate ?? '—',
              row.statusLabel,
              row.tutorName ?? 'Unassigned',
            ];

            let x = startX;
            for (const [index, column] of columns.entries()) {
              doc.text(cells[index], x, y, {
                width: column.width,
                lineBreak: false,
                ellipsis: true,
              });
              x += column.width;
            }
            y += 15;

            if (y > doc.page.height - doc.page.margins.bottom - 30) {
              doc.addPage();
              y = doc.page.margins.top;
              // Repeat the header: a cohort table running to twenty pages is
              // unreadable if only page one says what the columns are.
              drawHeader();
            }
          }
          doc.y = y;
        }

        doc.moveDown(1.5);
        doc
          .fontSize(8)
          .fillColor('#666666')
          .text(`Generated ${content.generatedAt.slice(0, 10)}.`, {
            align: 'center',
          })
          .fillColor('black');
      },
      { layout: 'landscape' },
    );
  }

  embedSignature(
    unsignedPdf: Buffer,
    signaturePng: Buffer,
    options: ISignedPdfOptions,
  ): Promise<Buffer> {
    return renderToBuffer((doc) => {
      doc.fontSize(18).text('Signed document', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11).text(`Signed at: ${options.signedAt.toISOString()}`, {
        align: 'left',
      });
      if (options.signerLabel) {
        doc.text(`Signer: ${options.signerLabel}`);
      }
      doc.moveDown();
      doc.text(`Source document size: ${unsignedPdf.length} bytes`);
      doc.moveDown();
      if (isPng(signaturePng)) {
        doc.image(signaturePng, { fit: [200, 80] });
      } else {
        doc.text('Signature image unavailable.');
      }
    });
  }
}
