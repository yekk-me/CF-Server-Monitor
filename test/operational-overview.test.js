import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlertOverview, resourceRuleSignature, readAlertOverview } from '../src/utils/alertOverview.js';
import { normalizeResourceAlertRules } from '../src/utils/settings.js';
import { operationalOverview } from '../src/frontend/utils/operationalOverview.js';

const now = new Date(2026, 9, 8, 12).getTime();
const rules = normalizeResourceAlertRules([
  { id: 'cpu', metric: 'cpu', threshold: 80, servers: ['a', 'hidden'], mode: 'average', intervalMinutes: 5 },
  { id: 'load', metric: 'load1', threshold: 5, servers: ['a', 'b'], mode: 'instant', intervalMinutes: 5 }
]);
const settings = { resource_alert_rules: rules };
const snapshot = { checkedAt: now, signature: resourceRuleSignature(rules), states: {
  'cpu:a': { status: 'active' }, 'load:a': { status: 'normal' }, 'load:b': { status: 'normal' }, 'cpu:hidden': { status: 'active' }
} };
function server(id, values = {}) {
  return { id, name: id, source: '', agent_version: 'v1', last_updated: now, timestamp: now, cpu: 20, ram_total: 100, ram_used: 40, ...values };
}

test('overview publishes only visible servers and evaluated rule states', () => {
  const result = buildAlertOverview(settings, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], snapshot, now);
  assert.equal(result.servers.length, 3);
  assert.deepEqual(result.servers[0].alerts, [{ metric: 'cpu', threshold: 80 }]);
  assert.equal(result.servers[1].unknownRules, 0);
  assert.equal(result.servers[2].monitored, false);
  assert.ok(!JSON.stringify(result).includes('hidden'));
  const partial = buildAlertOverview(settings, [{ id: 'a' }], { ...snapshot, states: { 'cpu:a': { status: 'active' } } }, now);
  assert.equal(partial.servers[0].unknownRules, 1);
  assert.equal(partial.servers[0].alerts.length, 1);
});

test('stale, missing, changed-rule and unavailable snapshots never imply normal', async () => {
  for (const value of [null, { ...snapshot, checkedAt: now - 180001 }, { ...snapshot, signature: 'old' }]) {
    const result = buildAlertOverview(settings, [{ id: 'a' }], value, now);
    assert.equal(result.checkedAt, null);
    assert.equal(result.servers[0].unknownRules, 2);
    assert.deepEqual(result.servers[0].alerts, []);
  }
  const result = await readAlertOverview({ prepare() { throw Error('D1 unavailable'); } }, settings, [{ id: 'a' }]);
  assert.equal(result.servers[0].unknownRules, 2);
});

test('operational cards deduplicate issues, preserve unknowns, and age live snapshots', () => {
  const servers = [server('a'), server('b', { last_updated: now - 300001 }), { id: 'c', name: 'c', cpu: 0, ram_total: 0 }];
  const data = buildAlertOverview(settings, servers, snapshot, now);
  const result = operationalOverview(servers, { '': data }, now);
  assert.equal(result.online.length, 1);
  assert.equal(result.offline.length, 1);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.abnormal.length, 2);
  assert.equal(result.cpu.length, 1);
  assert.equal(result.pressureUnknown, 2);
  assert.equal(result.unmonitored.length, 1);
  const aged = operationalOverview([server('a', { last_updated: now + 181000, timestamp: now + 181000 })], { '': data }, now + 181000);
  assert.equal(aged.pending.length, 1);
  assert.equal(aged.abnormal.length, 0);
});

test('peaks accept measured zero and omit missing or stale metrics', () => {
  const servers = [server('a', { cpu: 0, ram_used: 0 }), server('b', { cpu: null, ram_used: '' }), server('c', { timestamp: now - 180001, cpu: 99 })];
  const result = operationalOverview(servers, {}, now);
  assert.equal(result.cpu.length, 1);
  assert.equal(result.cpu[0].value, 0);
  assert.equal(result.ram.length, 1);
  assert.equal(result.ram[0].value, 0);
  assert.equal(result.pressureUnknown, 2);
});

test('expiry includes today and day 30, keeps missing dates unknown, and respects visibility', () => {
  const servers = [server('a', { expire_date: '2026-10-07' }), server('b', { expire_date: '2026-10-08' }), server('c', { expire_date: '2026-11-07' }), server('d', { expire_date: '2026-11-08' }), server('e', { expire_date: '2026-02-30' }), server('f')];
  const result = operationalOverview(servers, {}, now);
  assert.equal(result.expired.length, 1);
  assert.equal(result.expiring.length, 2);
  assert.equal(result.missingExpiry.length, 2);
  assert.equal(result.expiry.length, 4);
  assert.equal(operationalOverview(servers, {}, now, false).expiry.length, 0);
});

test('multi-site statuses do not cross-contaminate matching server ids', () => {
  const a = server('a', { source: 'https://one.example' });
  const b = server('a', { source: 'https://two.example' });
  const result = operationalOverview([a, b], { 'https://one.example': buildAlertOverview(settings, [a], snapshot, now) }, now);
  assert.equal(result.abnormal.length, 1);
  assert.equal(result.abnormal[0].server.source, a.source);
  assert.equal(result.pending.length, 1);
});

test('overview endpoint requires authentication for private sites', async () => {
  const { handleOverviewAPI } = await import('../src/handlers/dashboard.js');
  const response = await handleOverviewAPI(new Request('https://example.com/api/overview'), {
    DB: { prepare() { throw Error('must not read private state'); } }
  }, { is_public: 'false' });
  assert.equal(response.status, 401);
});

test('scheduled checks publish evaluated status without blocking notifications on snapshot failure', async () => {
  const { checkResourceAlerts } = await import('../src/services/notification.js');
  const { clearSiteSettingsCache } = await import('../src/utils/settings.js');
  const { clearServersListCache } = await import('../src/utils/cache.js');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  try {
    for (const { failSnapshot, recovering } of [{ failSnapshot: false }, { failSnapshot: true }, { failSnapshot: false, recovering: true }]) {
      clearSiteSettingsCache(); clearServersListCache();
      let sent = 0, savedSnapshot;
      globalThis.fetch = async () => { sent++; return new Response('{}'); };
      console.warn = () => {};
      const site = { ...settings, jwt_secret: 'a'.repeat(64), tg_bot_token: 'https://api.day.app/test-only' };
      const DB = { prepare(sql) {
        return {
          args: [], bind(...args) { this.args = args; return this; },
          async first() {
            if (sql.includes("key = 'site_options'")) return { value: JSON.stringify(site) };
            if (recovering && this.args[0] === 'resource_alert_state') return { value: JSON.stringify({
              signature: resourceRuleSignature(rules), servers: { 'cpu:a': { status: 'recovered', recoveredAt: Date.now() } }
            }) };
            return null;
          },
          async all() { return { results: sql.includes('FROM servers') ? [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] : [] }; },
          async run() {
            if (this.args[0] === 'resource_alert_overview') {
              if (failSnapshot) throw Error('snapshot unavailable');
              savedSnapshot = JSON.parse(this.args[1]);
            }
            return { meta: { changes: 1 } };
          }
        };
      } };
      const metric = { metric: 'cpu', current: 90, triggerValue: 90, threshold: 80, mode: 'average' };
      await checkResourceAlerts({ DB, METRICS_BROADCASTER: {
        idFromName() { return 'global'; }, get() { return { async fetch() {
          return Response.json({ results: [{ ruleId: 'cpu', evaluatedServerIds: ['a'], alerts: [{ serverId: 'a', metrics: [metric] }], evaluations: [{ serverId: 'a', metrics: [metric] }] }] });
        } }; }
      } });
      assert.equal(sent, recovering ? 0 : 1);
      if (!failSnapshot) {
        assert.equal(savedSnapshot.states['cpu:a'].status, 'active');
        const output = buildAlertOverview(site, [{ id: 'a' }, { id: 'b' }], savedSnapshot);
        assert.equal(output.servers[0].alerts.length, 1);
        assert.equal(output.servers[0].unknownRules, 1);
        assert.equal(output.servers[1].unknownRules, 1);
      }
    }
  } finally {
    globalThis.fetch = originalFetch; console.warn = originalWarn;
    clearSiteSettingsCache(); clearServersListCache();
  }
});
