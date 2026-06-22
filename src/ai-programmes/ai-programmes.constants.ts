/** Seeded platform provider org for FlowPortal AI programme catalogue (v1). */
export const AI_PROGRAMME_PROVIDER_ORG_SLUG = 'flowportal-ai-provider';

export const AI_PROGRAMME_PROVIDER_ORG_ID =
  'a1111111-1111-4111-8111-111111111111';

export const AI_PROGRAMME_CATALOGUE_SEED = {
  providerOrgId: AI_PROGRAMME_PROVIDER_ORG_ID,
  providerSlug: AI_PROGRAMME_PROVIDER_ORG_SLUG,
  programmes: [
    {
      id: 'a2222222-2222-4222-8222-222222222201',
      code: 'FLOW-AI-DEV',
      title: 'AI Software Developer',
      description:
        'FlowPortal AI track apprenticeship in software development with AI tooling.',
      standardId: 'a3333333-3333-4333-8333-333333333301',
      standardCode: 'FLOW-AI-DEV-STD',
      modules: [
        {
          slug: 'foundations',
          title: 'AI Foundations',
          sortOrder: 1,
          description: 'Introduction to AI concepts and responsible use.',
        },
        {
          slug: 'core-skills',
          title: 'Core AI Skills',
          sortOrder: 2,
          description: 'Practical AI-assisted development workflows.',
        },
        {
          slug: 'applied-project',
          title: 'Applied Project',
          sortOrder: 3,
          description:
            'Capstone project applying AI tools in a workplace context.',
        },
      ],
    },
    {
      id: 'a2222222-2222-4222-8222-222222222202',
      code: 'FLOW-AI-DATA',
      title: 'AI Data Analyst',
      description:
        'FlowPortal AI track apprenticeship in data analysis with AI augmentation.',
      standardId: 'a3333333-3333-4333-8333-333333333302',
      standardCode: 'FLOW-AI-DATA-STD',
      modules: [
        {
          slug: 'data-foundations',
          title: 'Data Foundations',
          sortOrder: 1,
          description: 'Data literacy and exploratory analysis basics.',
        },
        {
          slug: 'ai-analytics',
          title: 'AI-Assisted Analytics',
          sortOrder: 2,
          description: 'Using AI tools for insight generation and reporting.',
        },
      ],
    },
  ],
} as const;
