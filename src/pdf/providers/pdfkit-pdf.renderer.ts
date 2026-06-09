import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type {
  ICommitmentSnapshotContent,
  ILevyTransferAgreementContent,
  IPdfRenderer,
  IReviewSnapshotContent,
  ISignedPdfOptions,
} from '../interfaces/pdf-renderer.interface.js';

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
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
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
