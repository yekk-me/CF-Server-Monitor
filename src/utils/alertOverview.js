import { getResourceAlertConfig } from './settings.js';

export const ALERT_OVERVIEW_KEY = 'resource_alert_overview';
export const ALERT_OVERVIEW_MAX_AGE = 180_000;

export function resourceRuleSignature(rules) {
  return JSON.stringify({ rules: rules.map(({ id, name, metric, threshold, servers, intervalMinutes, mode }) => ({
    id, name, metric, threshold, servers, intervalMinutes, mode
  })) });
}

// Only publish results from an actual rule evaluation; missing samples stay unknown.
export function buildAlertOverview(settings, visibleServers, snapshot, now = Date.now()) {
  const { rules } = getResourceAlertConfig(settings);
  const fresh = snapshot?.signature === resourceRuleSignature(rules) &&
    Number.isFinite(snapshot?.checkedAt) && snapshot.checkedAt <= now &&
    now - snapshot.checkedAt <= ALERT_OVERVIEW_MAX_AGE;
  return {
    checkedAt: fresh ? snapshot.checkedAt : null,
    servers: visibleServers.map(server => {
      const applicable = rules.filter(rule => !rule.servers.length || rule.servers.includes(String(server.id)));
      const alerts = [];
      let unknownRules = 0;
      for (const rule of applicable) {
        const state = fresh ? snapshot?.states?.[`${rule.id}:${server.id}`] : null;
        if (!state || !['active', 'normal'].includes(state.status)) {
          unknownRules++;
          continue;
        }
        if (state.status === 'active') alerts.push({ metric: rule.metric, threshold: Number(rule.threshold) });
      }
      return { id: server.id, monitored: applicable.length > 0, unknownRules, alerts };
    })
  };
}

export async function readAlertOverview(db, settings, servers) {
  let snapshot = null;
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(ALERT_OVERVIEW_KEY).first();
    snapshot = row?.value ? JSON.parse(row.value) : null;
  } catch (_) { /* A missing or unavailable snapshot must not imply healthy. */ }
  return buildAlertOverview(settings, servers, snapshot);
}
