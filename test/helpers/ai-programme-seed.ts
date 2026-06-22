import type { Client } from 'pg';

/** Mirrors src/ai-programmes/ai-programmes.constants.ts for e2e seeding. */
export const AI_PROGRAMME_PROVIDER_ORG_ID =
  'a1111111-1111-4111-8111-111111111111';

export const AI_PROGRAMME_CATALOGUE_SEED = {
  providerOrgId: AI_PROGRAMME_PROVIDER_ORG_ID,
  providerSlug: 'flowportal-ai-provider',
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

/** Re-seed FlowPortal AI catalogue after e2e DB truncate. */
export async function seedAiProgrammeCatalogue(pg: Client): Promise<void> {
  const table = await pg.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_programme_modules'`,
  );
  if (!table.rowCount) {
    return;
  }

  const seed = AI_PROGRAMME_CATALOGUE_SEED;
  await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);

  await pg.query(
    `INSERT INTO organisations (id, name, slug, "portalType")
     VALUES ($1, $2, $3, 'provider')`,
    [seed.providerOrgId, 'FlowPortal AI Provider', seed.providerSlug],
  );

  for (const programme of seed.programmes) {
    await pg.query(
      `INSERT INTO programmes (id, "organisationId", code, title, description, status, "deliveryType")
       VALUES ($1, $2, $3, $4, $5, 'active', 'flowportal_ai')`,
      [
        programme.id,
        seed.providerOrgId,
        programme.code,
        programme.title,
        programme.description,
      ],
    );

    await pg.query(
      `INSERT INTO standards (id, "organisationId", "programmeId", code, title, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [
        programme.standardId,
        seed.providerOrgId,
        programme.id,
        programme.standardCode,
        `${programme.title} Standard`,
      ],
    );

    for (const mod of programme.modules) {
      await pg.query(
        `INSERT INTO ai_programme_modules ("organisationId", "programmeId", slug, title, "sortOrder", description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          seed.providerOrgId,
          programme.id,
          mod.slug,
          mod.title,
          mod.sortOrder,
          mod.description,
        ],
      );
    }
  }
}
