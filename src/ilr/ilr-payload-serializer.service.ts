/**
 * v1 serialises JSON for the REST ESFA client stub.
 * GROWTH(ILR-XML): add XmlPayloadSerializer for official ILR XML schema.
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
    return {
      organisationId: input.organisationId,
      ukprn: input.ukprn,
      collectionPeriod: input.collectionPeriod,
      academicYear: input.academicYear,
      fields: input.fields,
      isAmendment: input.isAmendment,
      priorEsfaReference: input.priorEsfaReference ?? null,
      learnerRecordId: input.learnerRecordId,
    };
  }

  toRequestBody(input: IIlrPayloadSerializerInput): Record<string, unknown> {
    return {
      ukprn: input.ukprn,
      collectionPeriod: input.collectionPeriod,
      academicYear: input.academicYear,
      isAmendment: input.isAmendment,
      priorEsfaReference: input.priorEsfaReference ?? null,
      learnerRecordId: input.learnerRecordId,
      fields: input.fields,
    };
  }
}
