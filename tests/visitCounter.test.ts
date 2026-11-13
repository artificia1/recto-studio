import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../visit-counter/worker.mjs';

const origin = 'https://artificia1.github.io';
const counterUrl = 'https://counter.example';
const token = 'test-totals-token';
const firstVisitor = '43d8561a-a810-49eb-ae6e-a6dcff660d3c';
const secondVisitor = 'b906d443-0efa-4b99-a717-fcefd894c6c0';
const schema = readFileSync(new URL('../visit-counter/migrations/0001_visits.sql', import.meta.url), 'utf8');

interface Statement {
  run(): unknown;
  first(): Promise<Record<string, unknown> | null>;
  bind(...values: ArrayBuffer[]): Statement;
}

function sqliteBinding(database: DatabaseSync) {
  const prepare = (sql: string, parameters: SQLInputValue[] = []): Statement => ({
    run: () => database.prepare(sql).run(...parameters),
    first: async () => database.prepare(sql).get(...parameters) ?? null,
    bind: (...values) => prepare(sql, values.map(value => new Uint8Array(value))),
  });
  return {
    prepare,
    async batch(statements: Statement[]) {
      database.exec('BEGIN');
      try {
        const result = statements.map(statement => statement.run());
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

describe('website visit counter', () => {
  let database: DatabaseSync;
  let env: ReturnType<typeof setup>;

  function setup() {
    return { SITE_ORIGIN: origin, VISITOR_KEY: '1'.repeat(64), TOTALS_TOKEN: token, COUNTER_DB: sqliteBinding(database) };
  }

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(schema);
    env = setup();
  });
  afterEach(() => database.close());

  const visit = (body: string, headers?: Record<string, string>) => worker.fetch(new Request(counterUrl + '/visit', {
    method: 'POST', body, headers: { Origin: origin, 'Content-Type': 'text/plain; charset=UTF-8', ...headers },
  }), env);
  const totals = async () => {
    const result = await worker.fetch(new Request(counterUrl + '/totals', {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    return result.json();
  };

  it('counts page loads separately from distinct browsers without storing the browser ID', async () => {
    expect(await totals()).toEqual({ totalVisits: 0, uniqueVisitors: 0 });
    const responses = await Promise.all([visit(firstVisitor), visit(firstVisitor.toUpperCase()), visit(secondVisitor)]);
    expect(responses.map(result => result.status)).toEqual([204, 204, 204]);
    expect(responses[0].headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(await totals()).toEqual({ totalVisits: 3, uniqueVisitors: 2 });
    const rows = database.prepare('SELECT hex(visitor_key) AS digest FROM visitors').all();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => /^[0-9A-F]{64}$/.test(String(row.digest)))).toBe(true);
  });

  it('disregards opt-out requests and rejects malformed and cross-site submissions', async () => {
    expect((await visit(firstVisitor, { 'Sec-GPC': '1' })).status).toBe(204);
    expect((await visit(firstVisitor, { DNT: '1' })).status).toBe(204);
    expect((await visit(firstVisitor, { Origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await visit(firstVisitor, { 'Content-Type': 'application/json' })).status).toBe(415);
    expect((await visit(firstVisitor + 'x')).status).toBe(400);
    expect((await visit(' '.repeat(1000))).status).toBe(400);
    expect((await visit(firstVisitor.replace('-4', '-1'))).status).toBe(400);
    expect(await totals()).toEqual({ totalVisits: 0, uniqueVisitors: 0 });
  });

  it('keeps totals private and does not allow GET to record a visit', async () => {
    for (const authorization of ['', 'Bearer incorrect']) {
      const result = await worker.fetch(new Request(counterUrl + '/totals', {
        headers: { Authorization: authorization, Origin: origin },
      }), env);
      expect(result.status).toBe(401);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    const result = await worker.fetch(new Request(counterUrl + '/visit', { headers: { Origin: origin } }), env);
    expect(result.status).toBe(405);
    expect(await totals()).toEqual({ totalVisits: 0, uniqueVisitors: 0 });
  });

  it('does not keep a visitor hash if its aggregate update fails', async () => {
    database.exec(`CREATE TRIGGER reject_visit BEFORE UPDATE ON counters
      BEGIN SELECT RAISE(ABORT, 'test database failure'); END;`);
    expect((await visit(firstVisitor)).status).toBe(503);
    expect(await totals()).toEqual({ totalVisits: 0, uniqueVisitors: 0 });
  });
});
