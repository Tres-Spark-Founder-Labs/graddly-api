import { Test } from '@nestjs/testing';

import { PDF_RENDERER } from './pdf.constants.js';
import { PdfService } from './pdf.service.js';

describe('PdfService', () => {
  const renderer = {
    renderHelloPdf: jest.fn(),
    renderReviewSnapshot: jest.fn(),
    renderCommitmentSnapshot: jest.fn(),
    renderLevyTransferAgreement: jest.fn(),
    renderLevyRoiReport: jest.fn(),
    embedSignature: jest.fn(),
  };

  let service: PdfService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PdfService, { provide: PDF_RENDERER, useValue: renderer }],
    }).compile();
    service = moduleRef.get(PdfService);
  });

  describe('renderHelloPdf', () => {
    it('delegates to the renderer', async () => {
      const buffer = Buffer.from('pdf');
      renderer.renderHelloPdf.mockResolvedValue(buffer);

      await expect(service.renderHelloPdf()).resolves.toBe(buffer);
      expect(renderer.renderHelloPdf).toHaveBeenCalled();
    });
  });

  describe('renderReviewSnapshot', () => {
    it('delegates to the renderer', async () => {
      const content = { reviewId: 'rev-1' } as never;
      const buffer = Buffer.from('review');
      renderer.renderReviewSnapshot.mockResolvedValue(buffer);

      await expect(service.renderReviewSnapshot(content)).resolves.toBe(buffer);
      expect(renderer.renderReviewSnapshot).toHaveBeenCalledWith(content);
    });
  });

  describe('renderCommitmentSnapshot', () => {
    it('delegates to the renderer', async () => {
      const content = { statementId: 'stmt-1' } as never;
      const buffer = Buffer.from('commitment');
      renderer.renderCommitmentSnapshot.mockResolvedValue(buffer);

      await expect(service.renderCommitmentSnapshot(content)).resolves.toBe(
        buffer,
      );
      expect(renderer.renderCommitmentSnapshot).toHaveBeenCalledWith(content);
    });
  });

  describe('renderLevyTransferAgreement', () => {
    it('delegates to the renderer', async () => {
      const content = { transferId: 'xfer-1' } as never;
      const buffer = Buffer.from('agreement');
      renderer.renderLevyTransferAgreement.mockResolvedValue(buffer);

      await expect(service.renderLevyTransferAgreement(content)).resolves.toBe(
        buffer,
      );
      expect(renderer.renderLevyTransferAgreement).toHaveBeenCalledWith(
        content,
      );
    });
  });

  describe('renderLevyRoiReport', () => {
    it('delegates to the renderer', async () => {
      const content = { organisationId: 'org-1' } as never;
      const buffer = Buffer.from('roi');
      renderer.renderLevyRoiReport.mockResolvedValue(buffer);

      await expect(service.renderLevyRoiReport(content)).resolves.toBe(buffer);
      expect(renderer.renderLevyRoiReport).toHaveBeenCalledWith(content);
    });
  });

  describe('embedSignature', () => {
    it('delegates to the renderer', async () => {
      const unsigned = Buffer.from('unsigned');
      const signature = Buffer.from('sig');
      const options = { pageIndex: 0, x: 10, y: 20, width: 100, height: 50 };
      const signed = Buffer.from('signed');
      renderer.embedSignature.mockResolvedValue(signed);

      await expect(
        service.embedSignature(unsigned, signature, options),
      ).resolves.toBe(signed);
      expect(renderer.embedSignature).toHaveBeenCalledWith(
        unsigned,
        signature,
        options,
      );
    });
  });
});
