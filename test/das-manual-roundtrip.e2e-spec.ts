import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';

import type { App } from 'supertest/types';

/**
 * Loading a form and saving it unchanged must not alter the stored rows.
 *
 * ── WHY THIS IS A ROUND TRIP AND NOT A FIELD COUNT ──────────────────────────
 *
 * The Levy data forms pre-populate from current values, because a blank form
 * plus a replace-all write would let an operator correcting one month wipe the
 * other eleven.
 *
 * That makes the READ the dangerous half. The obvious sources — the endpoints
 * the dashboard already uses — are shaped for display: they round, derive,
 * bucket, and omit. Load one of those into a form, press Save without touching
 * anything, and the lossy view is written over the real rows. The request
 * succeeds, the screen looks right, and the data is quietly worse. There is no
 * error to notice and no diff to review.
 *
 * Counting fields does not catch it, because the field that goes missing is
 * usually not one you thought to count — for the monthly series it is
 * `currency`, which `/reporting/levy-utilisation` does not carry at all.
 *
 * So each test below stores known rows, reads them back the way the form does,
 * writes them back unchanged, and compares the STORED rows before and after.
 * The comparison is against the database, not against the endpoint's own
 * output: a read that drops a column and a write that defaults it would agree
 * with each other perfectly while silently rewriting the column underneath.
 *
 * ── WHAT IS EXCLUDED FROM THE COMPARISON ────────────────────────────────────
 *
 * `updatedAt`, `lastSyncedAt` and the row id on delete-then-insert writes.
 * A second save genuinely is a second write, and recording when it happened is
 * correct. Everything that carries meaning is compared exactly, as the strings
 * Postgres returns for `numeric(14,2)` — so a value that made a detour through
 * a float and came back fails here rather than in a board report.
 *
 * Non-GBP currencies are used deliberately. A test written entirely in GBP
 * passes against a bug that resets every currency to the GBP default.
 */
describe('Manual levy data round trip (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let token: string;
  let organisationId: string;
  let userId: string;

  /**
   * A raw read of the stored rows, under an explicit tenant context.
   *
   * Every one of these four tables has row-level security enabled, and
   * `dataSource.query` borrows a pooled connection with no `app.current_org`
   * set — so an unscoped read returns zero rows and looks exactly like "the
   * write did not happen". The GUCs are set on the same connection, inside a
   * transaction, so they cannot leak to the next borrower.
   *
   * These assertions read the database directly on purpose: comparing the read
   * endpoint's own output before and after would pass even if the read dropped
   * a column the write then defaulted, which is the specific failure this whole
   * spec exists to catch.
   */
  const rawRows = async (
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    // The app re-applies its tenant GUCs from AsyncLocalStorage on every query,
    // so setting app.current_org by hand on a query runner is overwritten
    // before the SELECT runs. Entering the context the same way the other e2e
    // specs do is what actually scopes the read; without it every one of these
    // tables returns zero rows, which looks exactly like "the write never
    // happened".
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(userId);
    setLastKnownUserIdForGuc(userId);
    return dataSource.query(sql, params);
  };

  /** The value columns, in a stable order, for whole-row comparison. */
  const monthlyRows = async (): Promise<unknown[]> =>
    rawRows(
      `SELECT month, contributions, spend, currency, "isDeleted"
         FROM das_levy_monthly_entries
        WHERE "organisationId" = $1
        ORDER BY month ASC`,
      [organisationId],
    );

  const trancheRows = async (donorLinkId: string): Promise<unknown[]> =>
    rawRows(
      `SELECT amount, "expiresOn", "donorLinkId", "isDeleted"
         FROM das_levy_tranches
        WHERE "organisationId" = $1 AND "donorLinkId" = $2
        ORDER BY "expiresOn" ASC`,
      [organisationId, donorLinkId],
    );

  const paymentRows = async (): Promise<unknown[]> =>
    rawRows(
      `SELECT "externalReference", "paymentDate", amount, currency,
              "fundingPeriod", "clawbackNotice", "isDeleted"
         FROM das_funding_payments
        WHERE "organisationId" = $1
        ORDER BY "paymentDate" DESC`,
      [organisationId],
    );

  const balanceRow = async (): Promise<unknown[]> =>
    rawRows(
      `SELECT balance, currency, "accountId", ukprn, "lastSyncStatus"
         FROM das_levy_balances
        WHERE "organisationId" = $1`,
      [organisationId],
    );

  const auth = (req: request.Test): request.Test =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set(ORGANISATION_ID_HEADER, organisationId);

  const body = <T>(res: request.Response): T => (res.body as { data: T }).data;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);

    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `levy-roundtrip-${suffix}@example.com`,
    });
    token = owner.accessToken;
    userId = owner.userId;

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${token}`)
      .send(buildOrgPayload(`Roundtrip Org ${suffix}`))
      .expect(201);
    organisationId = body<{ id: string }>(orgRes).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the balance form', () => {
    it('stores the same row after loading and saving unchanged', async () => {
      await auth(
        request(app.getHttpServer()).post('/api/v1/das/manual/levy-balance'),
      )
        .send({
          balance: '48250.75',
          currency: 'EUR',
          accountId: 'MDAS-99887766',
          ukprn: '10001234',
        })
        .expect(201);

      const before = await balanceRow();
      expect(before).toHaveLength(1);

      // The form reuses GET /das/levy-balance, which keeps `balance` a string
      // and carries every field the form writes. This asserts that claim
      // rather than trusting it.
      const loaded = body<{
        balance: string | null;
        currency: string | null;
        accountId: string | null;
        ukprn: string | null;
      }>(
        await auth(
          request(app.getHttpServer()).get('/api/v1/das/levy-balance'),
        ).expect(200),
      );

      await auth(
        request(app.getHttpServer()).post('/api/v1/das/manual/levy-balance'),
      )
        .send({
          balance: loaded.balance,
          currency: loaded.currency,
          accountId: loaded.accountId,
          ukprn: loaded.ukprn,
        })
        .expect(201);

      expect(await balanceRow()).toEqual(before);
    });
  });

  describe('the monthly form', () => {
    const months = [
      {
        month: '2026-04',
        contributions: '4100.55',
        spend: '2750.05',
        currency: 'EUR',
      },
      {
        month: '2026-05',
        contributions: '4100.60',
        spend: '3000.10',
        currency: 'EUR',
      },
      {
        month: '2026-06',
        contributions: '0.00',
        spend: '1999.99',
        currency: 'EUR',
      },
    ];

    beforeAll(async () => {
      await auth(
        request(app.getHttpServer()).put('/api/v1/das/manual/levy-monthly'),
      )
        .send({ months })
        .expect(200);
    });

    it('stores the same rows after loading and saving unchanged', async () => {
      const before = await monthlyRows();
      expect(before).toHaveLength(3);

      const loaded = body<typeof months>(
        await auth(
          request(app.getHttpServer()).get('/api/v1/das/manual/levy-monthly'),
        ).expect(200),
      );

      // Sent back exactly as received — no reshaping, because reshaping here
      // would be the test doing the form's job of hiding a lossy read.
      await auth(
        request(app.getHttpServer()).put('/api/v1/das/manual/levy-monthly'),
      )
        .send({ months: loaded })
        .expect(200);

      expect(await monthlyRows()).toEqual(before);
    });

    it('returns money as strings, not numbers', async () => {
      const loaded = body<{ contributions: unknown; spend: unknown }[]>(
        await auth(
          request(app.getHttpServer()).get('/api/v1/das/manual/levy-monthly'),
        ).expect(200),
      );

      // `numeric(14,2)` arrives from the driver as a string. Typing it as a
      // number in a DTO is the conversion that makes a round trip lossy, and
      // it is invisible in JSON until a value needs more precision than a
      // double has.
      expect(typeof loaded[0].contributions).toBe('string');
      expect(typeof loaded[0].spend).toBe('string');
      expect(loaded[0].contributions).toBe('4100.55');
    });

    it('carries currency, which the display endpoint does not', async () => {
      const manual = body<{ currency?: string }[]>(
        await auth(
          request(app.getHttpServer()).get('/api/v1/das/manual/levy-monthly'),
        ).expect(200),
      );

      // This is the whole reason GET /das/manual/levy-monthly exists rather
      // than the form reading /reporting/levy-utilisation, whose DTO has no
      // currency field at all (see das-levy-monthly.service.ts). A form fed
      // from there and saved unchanged would rewrite every month to the 'GBP'
      // default — which is why a non-GBP value is stored above: an all-GBP
      // fixture passes against exactly that bug.
      expect(manual[0].currency).toBe('EUR');
    });
  });

  describe('the tranche form', () => {
    let donorLinkId: string;

    beforeAll(async () => {
      const link = body<{ id: string }>(
        await auth(
          request(app.getHttpServer()).post('/api/v1/das/manual/donor-link'),
        )
          .send({ label: 'Roundtrip Ltd', dasAccountId: 'MDAS-55443322' })
          .expect(201),
      );
      donorLinkId = link.id;

      await auth(
        request(app.getHttpServer()).put('/api/v1/das/manual/levy-tranches'),
      )
        .send({
          donorLinkId,
          tranches: [
            { amount: '7800.35', expiresOn: '2026-10-31' },
            { amount: '12000.00', expiresOn: '2027-03-31' },
          ],
        })
        .expect(200);
    });

    it('stores the same rows after loading and saving unchanged', async () => {
      const before = await trancheRows(donorLinkId);
      expect(before).toHaveLength(2);

      const loaded = body<{ amount: string; expiresOn: string }[]>(
        await auth(
          request(app.getHttpServer()).get(
            `/api/v1/das/manual/levy-tranches?donorLinkId=${donorLinkId}`,
          ),
        ).expect(200),
      );

      await auth(
        request(app.getHttpServer()).put('/api/v1/das/manual/levy-tranches'),
      )
        .send({ donorLinkId, tranches: loaded })
        .expect(200);

      expect(await trancheRows(donorLinkId)).toEqual(before);
    });

    it('returns the tranche rows, not the expiry projection', async () => {
      const loaded = body<{ amount: string; expiresOn: string }[]>(
        await auth(
          request(app.getHttpServer()).get(
            `/api/v1/das/manual/levy-tranches?donorLinkId=${donorLinkId}`,
          ),
        ).expect(200),
      );

      // Two tranches in, two rows out. /levy-exchange/surplus/expiry-calendar
      // returns 24 projected months derived from these rows, carrying neither
      // row identity nor donorLinkId, so it cannot populate a form whose write
      // is scoped to one link.
      expect(loaded).toHaveLength(2);
      expect(loaded[0].amount).toBe('7800.35');
      expect(loaded[0].expiresOn).toBe('2026-10-31');
    });

    it('does not return another account’s tranches', async () => {
      const other = body<{ id: string }>(
        await auth(
          request(app.getHttpServer()).post('/api/v1/das/manual/donor-link'),
        )
          .send({ label: 'Second Entity Ltd' })
          .expect(201),
      );

      // Replace-all is scoped to one link. If the read were not scoped the
      // same way, loading the form for one account and saving it would delete
      // the other account's tranches (F4.1.1 AC4).
      const loaded = body<unknown[]>(
        await auth(
          request(app.getHttpServer()).get(
            `/api/v1/das/manual/levy-tranches?donorLinkId=${other.id}`,
          ),
        ).expect(200),
      );
      expect(loaded).toEqual([]);
      expect(await trancheRows(donorLinkId)).toHaveLength(2);
    });
  });

  describe('the funding payment form', () => {
    const payment = {
      externalReference: 'ROUNDTRIP-PAY-001',
      paymentDate: '2026-04-15',
      amount: '9876.54',
      currency: 'EUR',
      fundingPeriod: '2026-27',
    };

    beforeAll(async () => {
      await auth(
        request(app.getHttpServer()).post(
          '/api/v1/das/manual/funding-payments',
        ),
      )
        .send(payment)
        .expect(201);
    });

    it('stores the same row after loading and saving unchanged', async () => {
      const before = await paymentRows();
      expect(before).toHaveLength(1);

      const loaded = body<
        {
          externalReference: string;
          paymentDate: string;
          amount: string;
          currency: string;
          fundingPeriod: string | null;
          clawbackNotice: string | null;
        }[]
      >(
        await auth(
          request(app.getHttpServer()).get(
            '/api/v1/das/manual/funding-payments',
          ),
        ).expect(200),
      );

      await auth(
        request(app.getHttpServer()).post(
          '/api/v1/das/manual/funding-payments',
        ),
      )
        .send({
          externalReference: loaded[0].externalReference,
          paymentDate: loaded[0].paymentDate,
          amount: loaded[0].amount,
          currency: loaded[0].currency,
          fundingPeriod: loaded[0].fundingPeriod,
        })
        .expect(201);

      expect(await paymentRows()).toEqual(before);
    });

    it('returns the amount as a string', async () => {
      const loaded = body<{ amount: unknown }[]>(
        await auth(
          request(app.getHttpServer()).get(
            '/api/v1/das/manual/funding-payments',
          ),
        ).expect(200),
      );

      expect(typeof loaded[0].amount).toBe('string');
      expect(loaded[0].amount).toBe('9876.54');
    });
  });
});
