/**
 * Serialises ILR learner rows for ESFA submit (v1 minimal field subset).
 * GROWTH(ILR-XML): expand to full annual ESFA specification via mapping config versions.
 */
import { Injectable } from '@nestjs/common';

import type { IIlrEsfaSubmitRequest } from './interfaces/ilr-esfa.client.interface.js';
import type {
  IIlrPayloadSerializer,
  IIlrPayloadSerializerInput,
} from './interfaces/ilr-payload-serializer.interface.js';

@Injectable()
export class IlrPayloadSerializerService implements IIlrPayloadSerializer {
  toSubmitRequest(input: IIlrPayloadSerializerInput): IIlrEsfaSubmitRequest {
    const xmlPayload = this.toIlrXml(input);
    return {
      organisationId: input.organisationId,
      ukprn: input.ukprn,
      collectionPeriod: input.collectionPeriod,
      academicYear: input.academicYear,
      fields: input.fields,
      isAmendment: input.isAmendment,
      priorEsfaReference: input.priorEsfaReference ?? null,
      learnerRecordId: input.learnerRecordId,
      xmlPayload,
    };
  }

  toRequestBody(input: IIlrPayloadSerializerInput): Record<string, unknown> {
    const xml = this.toIlrXml(input);
    return {
      format: 'ilr-xml',
      xml,
      ukprn: input.ukprn,
      collectionPeriod: input.collectionPeriod,
      academicYear: input.academicYear,
      isAmendment: input.isAmendment,
      priorEsfaReference: input.priorEsfaReference ?? null,
      learnerRecordId: input.learnerRecordId,
      fields: input.fields,
    };
  }

  toIlrXml(input: IIlrPayloadSerializerInput): string {
    const entityBlocks = Object.entries(input.fields)
      .map(([entityName, entityFields]) => {
        const fieldElements = Object.entries(entityFields)
          .filter(([, value]) => value !== null && String(value).trim() !== '')
          .map(
            ([fieldName, value]) =>
              `      <${fieldName}>${escapeXml(String(value))}</${fieldName}>`,
          )
          .join('\n');
        if (!fieldElements) {
          return '';
        }
        return `    <${entityName}>\n${fieldElements}\n    </${entityName}>`;
      })
      .filter(Boolean)
      .join('\n');

    const priorRef = input.priorEsfaReference?.trim()
      ? `\n    <PriorEsfaReference>${escapeXml(input.priorEsfaReference.trim())}</PriorEsfaReference>`
      : '';

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Message>',
      '  <Header>',
      `    <UKPRN>${escapeXml(input.ukprn)}</UKPRN>`,
      `    <CollectionPeriod>${escapeXml(input.collectionPeriod)}</CollectionPeriod>`,
      `    <AcademicYear>${escapeXml(input.academicYear)}</AcademicYear>`,
      `    <IsAmendment>${input.isAmendment ? 'true' : 'false'}</IsAmendment>`,
      `    <LearnerRecordId>${escapeXml(input.learnerRecordId)}</LearnerRecordId>${priorRef}`,
      '  </Header>',
      '  <LearnerRecords>',
      entityBlocks,
      '  </LearnerRecords>',
      '</Message>',
    ].join('\n');
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
