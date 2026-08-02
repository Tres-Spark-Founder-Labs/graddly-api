import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import { SarReportStatus } from './enums/sar-report-status.enum.js';
import { SAR_GRADE_LABELS } from './sar-template.config.js';

import type { SarMetrics, SarSection } from './entities/sar-report.entity.js';

export type SarDocxContent = {
  organisationName: string;
  academicYear: string;
  status: SarReportStatus;
  lockedAt: string | null;
  sections: SarSection[];
  metrics: SarMetrics;
};

/** "Not yet measurable" is a different statement from "0%". */
function rate(value: number | null | undefined): string {
  return value === null || value === undefined
    ? 'Not yet measurable'
    : `${value}%`;
}

function metricRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 60, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label })] })],
      }),
      new TableCell({
        width: { size: 40, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            children: [new TextRun({ text: value, bold: true })],
          }),
        ],
      }),
    ],
  });
}

/**
 * F2.1.3 AC3 — "exportable as Word document".
 *
 * A real `.docx`, not an HTML file with a Word extension or a PDF in
 * disguise. The point of the criterion is that a provider takes this away and
 * keeps writing in it: a SAR is a living document that goes through governors
 * and gets marked up before an inspection, so an export they cannot edit
 * would fail the requirement in spirit while passing it on paper.
 *
 * Built synchronously rather than through the PDF job queue. This is a few
 * pages of text with no images and no page-level layout work — it renders in
 * milliseconds, and putting it behind a queue would add a poll cycle and a
 * failure mode to something that has neither.
 */
@Injectable()
export class SarDocxRenderer {
  async render(content: SarDocxContent): Promise<Buffer> {
    const children: (Paragraph | Table)[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Self-Assessment Report', bold: true, size: 40 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: content.organisationName, size: 28 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `Academic year ${content.academicYear}`,
            size: 24,
          }),
        ],
      }),
      this.statusParagraph(content),
      new Paragraph({ text: '' }),

      new Paragraph({
        text: 'Supporting data',
        heading: HeadingLevel.HEADING_1,
      }),
      /**
       * The provenance line matters more than it looks. A SAR is read months
       * after it is written, and "where did 84% come from and when" is the
       * first question anyone asks of a number in it.
       */
      new Paragraph({
        children: [
          new TextRun({
            text:
              content.status === SarReportStatus.LOCKED
                ? `Figures frozen when this report was locked on ${(content.lockedAt ?? '').slice(0, 10)}.`
                : `Figures as at ${(content.metrics?.capturedAt ?? '').slice(0, 10)}. This report is still a draft, so they will move until it is locked.`,
            italics: true,
            size: 20,
          }),
        ],
      }),
      new Paragraph({ text: '' }),
      this.metricsTable(content.metrics),
      new Paragraph({ text: '' }),
    ];

    for (const section of content.sections) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_1,
        }),
      );
      if (section.grade) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Self-assessed grade: ', bold: true }),
              new TextRun({
                text: SAR_GRADE_LABELS[section.grade] ?? section.grade,
              }),
            ],
          }),
        );
      }
      // Blank lines in the narrative are the writer's paragraph breaks, so
      // they have to survive into the document rather than collapsing.
      for (const line of (section.narrative || '').split('\n')) {
        children.push(new Paragraph({ text: line }));
      }
      children.push(new Paragraph({ text: '' }));
    }

    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  }

  private statusParagraph(content: SarDocxContent): Paragraph {
    const locked = content.status === SarReportStatus.LOCKED;
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: locked
            ? `Locked ${(content.lockedAt ?? '').slice(0, 10)}${
                content.metrics?.lockedByName
                  ? ` by ${content.metrics.lockedByName}`
                  : ''
              }`
            : 'DRAFT — not yet locked',
          bold: true,
          color: locked ? '2E7D32' : 'C0392B',
        }),
      ],
    });
  }

  private metricsTable(metrics: SarMetrics): Table {
    const rows: TableRow[] = [
      metricRow(
        'Overall EIF readiness',
        metrics?.eifOverallPercent === null ||
          metrics?.eifOverallPercent === undefined
          ? 'Not yet measurable'
          : `${metrics.eifOverallPercent}%`,
      ),
    ];

    for (const criterion of metrics?.eifCriteria ?? []) {
      rows.push(
        metricRow(
          `  ${criterion.label}`,
          `${criterion.percent}% (${criterion.rag})`,
        ),
      );
    }

    const qip = metrics?.qip;
    rows.push(
      metricRow(
        'QIP actions complete',
        qip
          ? `${qip.completed} of ${qip.total} (${qip.percentComplete}%)`
          : 'None recorded',
      ),
      metricRow('QIP actions overdue', String(qip?.overdue ?? 0)),
    );

    const outcomes = metrics?.outcomes;
    rows.push(
      metricRow('Apprentices in learning', String(outcomes?.activeCount ?? 0)),
      metricRow('Completions', String(outcomes?.completedCount ?? 0)),
      metricRow('Withdrawn', String(outcomes?.withdrawnCount ?? 0)),
      metricRow(
        'End-point assessment pass rate',
        outcomes?.epaAssessedCount
          ? `${outcomes.epaPassRate}% of ${outcomes.epaAssessedCount} assessed`
          : 'No outcomes recorded yet',
      ),
      metricRow('Review compliance', rate(metrics?.reviewComplianceRate)),
      metricRow('Withdrawal rate', rate(metrics?.withdrawalRate)),
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  }
}
