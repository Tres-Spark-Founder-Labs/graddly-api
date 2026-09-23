import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';

/** The one thing these specs do with a registered job: stop it on destroy. */
export type CronJobDouble = { stop: jest.Mock };

export type SchedulerRegistryDouble = {
  /** Passed to the service under test in place of the real registry. */
  registry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  /** What the service registered, by cron name. */
  jobs: Map<string, CronJobDouble>;
};

/**
 * A `SchedulerRegistry` double for the eleven cron specs.
 *
 * ── WHY IT IS SHARED, AND WHERE THE CASTS ARE ───────────────────────────────
 *
 * Each cron spec had its own copy of this object, and each copy produced
 * three `tsc --noEmit` errors: `jest.fn()` returning a `{ stop }` stub is not
 * a `CronJob<null, null>`, and `doesExist(type: string)` is not
 * `doesExist(type: 'cron' | 'timeout' | 'interval')`. Thirty-three of the
 * repository's 241 type errors were this duplication — invisible, because
 * ts-jest does not type-check.
 *
 * The specs only ever register a job and later stop it, so the double keeps a
 * `{ stop }` stub and the two casts that reconcile it with the real
 * signatures live here, once, named and explained. Widening
 * `SchedulerRegistry`'s own types is not an option: it is a library type.
 */
export function createSchedulerRegistryDouble(): SchedulerRegistryDouble {
  const jobs = new Map<string, CronJobDouble>();

  const registry: SchedulerRegistryDouble['registry'] = {
    addCronJob: jest.fn((name: string, job: CronJob<null, null>) => {
      jobs.set(name, job as unknown as CronJobDouble);
    }),
    doesExist: jest.fn((_type: 'cron' | 'timeout' | 'interval', name: string) =>
      jobs.has(name),
    ),
    getCronJob: jest.fn(
      (name: string) => jobs.get(name) as unknown as CronJob<null, null>,
    ),
    deleteCronJob: jest.fn((name: string) => {
      jobs.delete(name);
    }),
  };

  return { registry, jobs };
}
