export enum RegistrationWizardStep {
  COMPANY_VERIFICATION = 'company_verification',
  PAYE_REFERENCE = 'paye_reference',
  DAS_ACCOUNT = 'das_account',
  BANK_DETAILS = 'bank_details',
  CONSENT = 'consent',
}

export const REGISTRATION_WIZARD_STEP_ORDER: RegistrationWizardStep[] = [
  RegistrationWizardStep.COMPANY_VERIFICATION,
  RegistrationWizardStep.PAYE_REFERENCE,
  RegistrationWizardStep.DAS_ACCOUNT,
  RegistrationWizardStep.BANK_DETAILS,
  RegistrationWizardStep.CONSENT,
];
