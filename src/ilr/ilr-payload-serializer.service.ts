/**
 * Serialises ILR learner rows for ESFA submit (v1 minimal field subset).
 * GROWTH(ILR-XML): expand to full annual ESFA specification via mapping config versions.
 */
import { Injectable } from '@nestjs/common';

import type { IIlrEsfaSubmitRequest } from './interfaces/ilr-esfa.client.interface.js';
import type {
  IIlrPayloadSerializer,
  IIlrPayloadSerializerInput,
  IIlrReturnXmlInput,
} from './interfaces/ilr-payload-serializer.interface.js';

/** Entities that describe the provider, written once, not per learner. */
const PROVIDER_ENTITY = 'Provider';
/** The entity each learner's element is named after; the rest nest inside it. */
const LEARNER_ENTITY = 'Learner';

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

  toIlrReturnXml(input: IIlrReturnXmlInput): string {
    return toIlrReturnXml(input);
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
      .map(([entityName, entityFields]) =>
        renderEntity(entityName, entityFields, '    '),
      )
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

/**
 * F2.3.2 / 5.4 — the provider's whole return for a collection period, as
 * one ILR XML file for Submit Learner Data.
 *
 * Same field rendering as the per-record submit payload (`renderEntity`:
 * the same escaping, the same empty-field omission), in the envelope a
 * return file needs: one message for the provider, one `<Learner>` per
 * learner record with its other entities nested inside it, and the
 * provider entity written once as `<LearningProvider>`.
 *
 * Shaped after the ESFA ILR message (namespace, Header, CollectionDetails,
 * Source, LearningProvider, Learner) but not validated against the annual
 * XSD: the mapping config carries the v1 field subset, and the coverage
 * note at the top of the file says so.
 */
export function returnYearCode(academicYear: string): string {
  // "2025-26" → "2526"
  const [start, end] = academicYear.split('-');
  return `${start.slice(2)}${end}`;
}

/** Date and time parts in UK time, as ESFA file names and headers use. */
export function ukDateTimeParts(date: Date): {
  date: string;
  time: string;
  iso: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${hour}${parts.minute}${parts.second}`,
    iso: `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`,
  };
}

/** `ILR-{UKPRN}-{year}-{yyyymmdd}-{hhmmss}-{serial}.XML`, ESFA's naming. */
export function ilrReturnFilename(
  ukprn: string,
  academicYear: string,
  generatedAt: Date,
  serial = '01',
): string {
  const { date, time } = ukDateTimeParts(generatedAt);
  return `ILR-${ukprn}-${returnYearCode(academicYear)}-${date}-${time}-${serial}.XML`;
}

function renderEntity(
  entityName: string,
  entityFields: Record<string, string | null>,
  indent: string,
  children: string[] = [],
): string {
  const fieldElements = Object.entries(entityFields)
    .filter(([, value]) => value !== null && String(value).trim() !== '')
    .map(
      ([fieldName, value]) =>
        `${indent}  <${fieldName}>${escapeXml(String(value))}</${fieldName}>`,
    );
  const body = [...fieldElements, ...children];
  if (body.length === 0) {
    return '';
  }
  return `${indent}<${entityName}>\n${body.join('\n')}\n${indent}</${entityName}>`;
}

export function toIlrReturnXml(input: IIlrReturnXmlInput): string {
  const year = returnYearCode(input.academicYear);
  const when = ukDateTimeParts(input.generatedAt);

  const learners = input.learners
    .map(({ fields }) => {
      const nested = Object.entries(fields)
        .filter(
          ([entity]) => entity !== LEARNER_ENTITY && entity !== PROVIDER_ENTITY,
        )
        .map(([entity, entityFields]) =>
          renderEntity(entity, entityFields, '    '),
        )
        .filter(Boolean);
      return renderEntity(
        LEARNER_ENTITY,
        fields[LEARNER_ENTITY] ?? {},
        '  ',
        nested,
      );
    })
    .filter(Boolean)
    .join('\n');

  const versions = [...new Set(input.mappingConfigVersions)]
    .sort((a, b) => a - b)
    .join(', ');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${escapeComment(input.coverage)} -->`,
    `<!-- Collection period ${escapeComment(input.collectionPeriod)}: ${input.learners.length} learner record(s). Mapping config version(s) ${versions}. -->`,
    `<Message xmlns="ESFA/ILR/${escapeXml(input.academicYear)}">`,
    '  <Header>',
    '    <CollectionDetails>',
    '      <Collection>ILR</Collection>',
    `      <Year>${year}</Year>`,
    `      <FilePreparationDate>${when.iso.slice(0, 10)}</FilePreparationDate>`,
    '    </CollectionDetails>',
    '    <Source>',
    '      <ProtectiveMarking>OFFICIAL-SENSITIVE-Personal</ProtectiveMarking>',
    `      <UKPRN>${escapeXml(input.ukprn)}</UKPRN>`,
    '      <SoftwareSupplier>Gradlly</SoftwareSupplier>',
    '      <SoftwarePackage>Gradlly</SoftwarePackage>',
    `      <Release>mapping-config-${escapeXml(versions)}</Release>`,
    '      <SerialNo>01</SerialNo>',
    `      <DateTime>${when.iso}</DateTime>`,
    '    </Source>',
    '  </Header>',
    '  <LearningProvider>',
    `    <UKPRN>${escapeXml(input.ukprn)}</UKPRN>`,
    '  </LearningProvider>',
    learners,
    '</Message>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** "--" may not appear inside an XML comment. */
function escapeComment(value: string): string {
  return value.replace(/-{2,}/g, '-');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
