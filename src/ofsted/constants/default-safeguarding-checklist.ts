export interface IDefaultSafeguardingChecklistItem {
  slug: string;
  label: string;
}

export const DEFAULT_SAFEGUARDING_CHECKLIST_ITEMS: IDefaultSafeguardingChecklistItem[] =
  [
    {
      slug: 'policy_published',
      label: 'Safeguarding policy published',
    },
    {
      slug: 'dsl_appointed',
      label: 'Designated safeguarding lead appointed',
    },
    {
      slug: 'staff_training',
      label: 'Staff safeguarding training completed',
    },
    {
      slug: 'reporting_procedure',
      label: 'Reporting procedure documented',
    },
  ];
