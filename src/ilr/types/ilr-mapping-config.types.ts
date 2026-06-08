export type IlrFieldSource =
  | 'manual'
  | 'constant'
  | `enrolment.${string}`
  | `apprentice.${string}`
  | `standard.${string}`
  | `organisation.${string}`;

export type IlrFieldTransform = 'ilrDate' | 'ilrRef';

export type IlrFieldDefinition = {
  source: IlrFieldSource;
  required?: boolean;
  transform?: IlrFieldTransform;
  value?: string;
};

export type IlrValidationSeverity = 'error' | 'warn';

export type IlrValidationRuleDefinition = {
  code: string;
  severity: IlrValidationSeverity;
  field: string;
  type: 'required' | 'dateNotAfter';
  otherField?: string;
  message: string;
};

export type IlrMappingConfigDocument = {
  academicYear: string;
  entities: Record<string, Record<string, IlrFieldDefinition>>;
  rules: IlrValidationRuleDefinition[];
  _comment?: string;
};

export type IlrFieldMap = Record<string, Record<string, string | null>>;

export type IlrValidationIssue = {
  code: string;
  field: string;
  severity: IlrValidationSeverity;
  message: string;
};

export type IlrValidationSummary = {
  errorCount: number;
  warnCount: number;
};
