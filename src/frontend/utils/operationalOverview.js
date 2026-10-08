const DAY = 86_400_000;
const number = value => value === null || value === undefined || String(value).trim() === ''
  ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const timestamp = value => {
  if (value === null || value === undefined || value === '') return null;
  const result = typeof value === 'number' ? value : (/^\d+$/.test(value) ? Number(value) : Date.parse(value));
  return Number.isFinite(result) && result > 0 ? result : null;
};
export const serverKey = server => `${server.source || ''}|${server.id}`;

export function operationalOverview(servers, snapshots, now, showExpiry = true) {
  const result = { online: [], offline: [], unknown: [], abnormal: [], pending: [], unmonitored: [], cpu: [], ram: [], pressureUnknown: 0, expired: [], expiring: [], missingExpiry: [], expiry: [] };
  const today = new Date(now);
  const todaySerial = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY;
  for (const server of servers) {
    const reportTs = timestamp(server.report_timestamp ?? server.last_updated ?? server.timestamp);
    const observed = number(server.ram_total) > 0 || Boolean(server.agent_version);
    const online = observed && reportTs !== null && reportTs <= now + 60_000 && now - reportTs < 300_000;
    const reasons = [];
    if (!observed || !reportTs) result.unknown.push(server);
    else if (online) result.online.push(server);
    else { result.offline.push(server); reasons.push({ metric: 'offline' }); }

    const snapshot = snapshots[server.source || ''];
    const fresh = snapshot?.checkedAt && snapshot.checkedAt <= now && now - snapshot.checkedAt <= 180_000;
    const state = snapshot?.servers?.find(item => item.id === server.id);
    if (state?.monitored === false) result.unmonitored.push(server);
    else if (!fresh || !state || state.unknownRules > 0) result.pending.push(server);
    if (fresh && state && online) reasons.push(...state.alerts);
    if (reasons.length) result.abnormal.push({ server, reasons });

    const sampleTs = timestamp(server.sample_timestamp ?? server.timestamp ?? server.last_updated);
    const freshMetrics = online && sampleTs && sampleTs <= now + 60_000 && now - sampleTs <= 180_000;
    const cpu = number(server.cpu);
    const total = number(server.ram_total), used = number(server.ram_used);
    const ram = total > 0 && used !== null && used >= 0 ? used / total * 100 : null;
    if (freshMetrics && cpu !== null && cpu >= 0) result.cpu.push({ server, value: cpu });
    if (freshMetrics && ram !== null) result.ram.push({ server, value: ram });
    if (!freshMetrics || cpu === null || cpu < 0 || ram === null) result.pressureUnknown++;

    if (showExpiry) {
      const raw = String(server.expire_date || '');
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const date = match ? new Date(`${raw}T00:00:00Z`) : null;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
        result.missingExpiry.push(server);
      } else {
        const days = date.getTime() / DAY - todaySerial;
        const entry = { server, days, date: raw };
        result.expiry.push(entry);
        if (days < 0) result.expired.push(entry);
        else if (days <= 30) result.expiring.push(entry);
      }
    }
  }
  result.cpu.sort((a, b) => b.value - a.value);
  result.ram.sort((a, b) => b.value - a.value);
  result.expiry.sort((a, b) => a.days - b.days);
  return result;
}
