<template>
  <section class="operations-overview" :aria-label="t.overview">
    <div class="operations-grid">
      <button class="operation-card" :aria-expanded="panel === 'servers'" @click="toggle('servers')">
        <span class="operation-label">{{ t.servers }} <span aria-hidden="true">↗</span></span>
        <strong><span class="good">{{ summary.online.length }}</span><small> / {{ servers.length }}</small></strong>
        <span class="operation-caption">{{ t.online }} · <span :class="{ danger: summary.offline.length }">{{ summary.offline.length }} {{ t.offline }}</span></span>
        <span class="operation-note">{{ summary.unknown.length ? `${summary.unknown.length} ${t.noReport}` : t.connectivity }}</span>
      </button>
      <button class="operation-card" :class="{ 'has-alert': summary.abnormal.length }" :aria-expanded="panel === 'alerts'" @click="toggle('alerts')">
        <span class="operation-label">{{ t.abnormal }} <span aria-hidden="true">↗</span></span>
        <strong :class="{ danger: summary.abnormal.length }">{{ summary.abnormal.length }}<small> {{ t.nodes }}</small></strong>
        <span class="operation-caption">{{ summary.abnormal.length ? summary.abnormal.slice(0, 2).map(item => item.server.name).join(' / ') : t.noConfirmed }}</span>
        <span class="operation-note">{{ summary.pending.length }} {{ t.pending }} · {{ summary.unmonitored.length }} {{ t.unmonitored }}</span>
      </button>
      <button class="operation-card" :aria-expanded="panel === 'pressure'" @click="toggle('pressure')">
        <span class="operation-label">{{ t.pressure }} <span aria-hidden="true">↗</span></span>
        <strong class="pressure-value">CPU {{ percent(summary.cpu[0]?.value) }}<small> · MEM {{ percent(summary.ram[0]?.value) }}</small></strong>
        <span class="operation-caption">{{ t.cpuPeak }} {{ summary.cpu[0]?.server.name || '—' }}</span>
        <span class="operation-note">{{ t.memPeak }} {{ summary.ram[0]?.server.name || '—' }} · {{ summary.pressureUnknown }} {{ t.staleMetrics }}</span>
      </button>
      <button class="operation-card" :aria-expanded="panel === 'expiry'" @click="toggle('expiry')">
        <span class="operation-label">{{ t.expiry }} <span aria-hidden="true">↗</span></span>
        <strong :class="{ danger: summary.expired.length }">{{ showExpiry ? summary.expired.length + summary.expiring.length : '—' }}<small v-if="showExpiry"> {{ t.nodes }}</small></strong>
        <span class="operation-caption">{{ showExpiry ? `${summary.expired.length} ${t.expired} · ${summary.expiring.length} ${t.in30Days}` : t.expiryHidden }}</span>
        <span class="operation-note">{{ showExpiry ? `${summary.missingExpiry.length} ${t.noExpiry}` : t.checkSettings }}</span>
      </button>
    </div>

    <div v-if="panel" class="operation-details">
      <div class="operation-details-header"><h3>{{ titles[panel] }}</h3><button type="button" @click="panel = null" :aria-label="t.close">✕</button></div>
      <template v-if="panel === 'alerts'">
        <p class="operation-help">{{ t.alertHelp }}</p>
        <div v-for="item in summary.abnormal" :key="serverKey(item.server)" class="operation-row">
          <RouterLink :to="serverLink(item.server)">{{ item.server.name }}</RouterLink>
          <span class="danger">{{ item.reasons.map(reasonText).join(' · ') }}</span>
        </div>
        <p v-if="!summary.abnormal.length">{{ t.noConfirmed }}</p>
        <p v-if="summary.pending.length" class="operation-help">{{ t.pendingNames }}: {{ summary.pending.map(s => s.name).join('、') }}</p>
        <p v-if="summary.unmonitored.length" class="operation-help">{{ t.unmonitored }}: {{ summary.unmonitored.map(s => s.name).join('、') }}</p>
      </template>
      <template v-else-if="panel === 'pressure'">
        <p class="operation-help">{{ t.pressureHelp }}</p>
        <div v-for="server in pressureServers" :key="serverKey(server)" class="operation-row">
          <RouterLink :to="serverLink(server)">{{ server.name }}</RouterLink>
          <span>CPU {{ percent(valueFor(summary.cpu, server)) }} · MEM {{ percent(valueFor(summary.ram, server)) }}</span>
        </div>
      </template>
      <template v-else-if="panel === 'expiry'">
        <p v-if="!showExpiry" class="operation-help">{{ t.expiryHidden }}</p>
        <template v-else>
          <p class="operation-help">{{ t.expiryHelp }}</p>
          <div v-for="item in summary.expiry" :key="serverKey(item.server)" class="operation-row">
            <RouterLink :to="serverLink(item.server)">{{ item.server.name }}</RouterLink>
            <span :class="{ danger: item.days < 0 }">{{ item.date }} · {{ item.days < 0 ? t.expired : item.days === 0 ? t.today : `${item.days} ${t.daysLeft}` }}</span>
          </div>
          <p v-if="summary.missingExpiry.length" class="operation-help">{{ t.noExpiry }}: {{ summary.missingExpiry.map(s => s.name).join('、') }}</p>
        </template>
      </template>
      <template v-else>
        <div v-for="server in servers" :key="serverKey(server)" class="operation-row">
          <RouterLink :to="serverLink(server)">{{ server.name }}</RouterLink>
          <span :class="{ good: summary.online.includes(server), danger: summary.offline.includes(server) }">{{ summary.online.includes(server) ? t.online : summary.offline.includes(server) ? t.offline : t.noReport }}</span>
        </div>
      </template>
      <p v-if="!servers.length" class="operation-help">{{ t.empty }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { currentLang } from '../utils/i18n.js'
import { http } from '../utils/http.js'
import { getApiBases } from '../utils/config.js'
import { operationalOverview, serverKey } from '../utils/operationalOverview.js'
const props = defineProps({ servers: { type: Array, required: true }, now: { type: Number, required: true }, showExpiry: { type: Boolean, default: true }, serverLink: { type: Function, required: true } })
const panel = ref(null)
const snapshots = ref({})
const summary = computed(() => operationalOverview(props.servers, snapshots.value, props.now, props.showExpiry))
const t = computed(() => currentLang.value === 'zh' ? {
  overview: '运行总览', servers: '服务器', online: '在线', offline: '离线', noReport: '尚无上报', connectivity: '5 分钟内有上报视为在线',
  abnormal: '异常服务器', nodes: '台', noConfirmed: '暂无已确认异常', pending: '台资源状态待确认', unmonitored: '台未配置资源规则',
  pressure: '资源压力 · 当前峰值', cpuPeak: 'CPU 最高：', memPeak: '内存最高：', staleMetrics: '台数据待更新',
  expiry: '到期提醒', expired: '已到期', in30Days: '30 天内到期', noExpiry: '未填写到期日', expiryHidden: '到期信息已隐藏', checkSettings: '可在后台显示设置中开启',
  close: '收起', alertHelp: '离线与后台已触发的资源告警合并计数，每台只计一次。资源告警每分钟检查；待确认不代表正常。', pendingNames: '资源检查尚未完成或已过期',
  pressureHelp: '仅比较最近 3 分钟内的在线服务器数据；峰值为当前值，不等于已触发告警。',
  expiryHelp: '按本地日期统计，包含今天及未来 30 天；未填写日期不计为未到期。', today: '今天到期', daysLeft: '天后到期', empty: '尚未添加服务器',
  load1: '1 分钟负载', load5: '5 分钟负载', cpu: 'CPU', ram: '内存', disk: '磁盘', netIn: '下行网速', netOut: '上行网速', triggered: '告警'
} : {
  overview: 'Operations overview', servers: 'Servers', online: 'Online', offline: 'Offline', noReport: 'Awaiting report', connectivity: 'Reported within the last 5 minutes',
  abnormal: 'Servers needing attention', nodes: 'servers', noConfirmed: 'No confirmed issues', pending: 'resource checks pending', unmonitored: 'without resource rules',
  pressure: 'Resource pressure · current peaks', cpuPeak: 'Highest CPU:', memPeak: 'Highest memory:', staleMetrics: 'awaiting metrics',
  expiry: 'Expiry reminders', expired: 'expired', in30Days: 'due within 30 days', noExpiry: 'No expiry date', expiryHidden: 'Expiry information is hidden', checkSettings: 'Enable in display settings',
  close: 'Collapse', alertHelp: 'Offline servers and triggered resource alerts are counted once per server. Rules are checked every minute; pending does not mean healthy.', pendingNames: 'Checks pending or stale',
  pressureHelp: 'Only online servers with metrics from the last 3 minutes are compared. Current peaks are not alert status.',
  expiryHelp: 'Uses your local date, including today and the next 30 days. Missing dates remain unknown.', today: 'Due today', daysLeft: 'days remaining', empty: 'No servers yet',
  load1: 'Load (1 min)', load5: 'Load (5 min)', cpu: 'CPU', ram: 'Memory', disk: 'Disk', netIn: 'Inbound speed', netOut: 'Outbound speed', triggered: 'alert'
})
const titles = computed(() => ({ servers: t.value.servers, alerts: t.value.abnormal, pressure: t.value.pressure, expiry: t.value.expiry }))
const toggle = name => { panel.value = panel.value === name ? null : name }
const percent = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
const valueFor = (items, server) => items.find(item => serverKey(item.server) === serverKey(server))?.value
const pressureServers = computed(() => [...props.servers].sort((a, b) => (valueFor(summary.value.cpu, b) ?? -1) - (valueFor(summary.value.cpu, a) ?? -1)))
const reasonText = reason => reason.metric === 'offline' ? t.value.offline : `${t.value[reason.metric] || reason.metric} ${t.value.triggered} (${reason.threshold}${['cpu', 'ram', 'disk'].includes(reason.metric) ? '%' : ['netIn', 'netOut'].includes(reason.metric) ? ' Mbps' : ''})`
let timer, disposed = false, loading = false
async function refresh() {
  if (loading || disposed || document.hidden) return
  loading = true
  try {
    const bases = getApiBases()
    const targets = bases.length ? bases : ['']
    const entries = await Promise.all(targets.map(async (base, index) => {
      try {
        const response = await http.getByIndex('/api/overview', index, { autoRedirect: false, timeoutMs: 10000 })
        return [base, response.error ? null : response.data]
      } catch (_) { return [base, null] }
    }))
    if (!disposed) snapshots.value = Object.fromEntries(entries)
  } finally { loading = false }
}
onMounted(() => { refresh(); timer = setInterval(refresh, 60_000); document.addEventListener('visibilitychange', refresh) })
onUnmounted(() => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) })
</script>

<style scoped>
.operations-overview { margin-bottom: 24px; }
.operations-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.operation-card { display: flex; flex-direction: column; gap: 9px; min-width: 0; padding: 19px 18px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); text-align: left; font: inherit; cursor: pointer; }
.operation-card:hover, .operation-card[aria-expanded="true"] { border-color: var(--accent-cyan); }
.operation-card:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 3px; }
.operation-card.has-alert { border-color: var(--accent-red); }
.operation-label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.operation-card strong { font-size: 30px; line-height: 1.25; font-weight: 650; font-variant-numeric: tabular-nums; }
.operation-card strong small { font-size: 14px; font-weight: 400; color: var(--text-secondary); }
.operation-card strong.pressure-value { font-size: 20px; min-height: 38px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.operation-caption { font-size: 12px; min-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.operation-note { font-size: 11px; color: var(--text-muted); line-height: 1.6; }
.good { color: var(--accent-green); } .danger { color: var(--accent-red); }
.operation-details { margin-top: 12px; padding: 18px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; }
.operation-details-header { display: flex; align-items: center; justify-content: space-between; }
.operation-details-header h3 { font-size: 14px; margin: 0; }
.operation-details-header button { background: transparent; border: 0; color: var(--text-secondary); cursor: pointer; padding: 8px; }
.operation-help { font-size: 12px; color: var(--text-secondary); line-height: 1.8; margin: 10px 0; overflow-wrap: anywhere; }
.operation-row { display: flex; gap: 16px; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-color); font-size: 13px; }
.operation-row a { color: var(--accent-cyan); overflow-wrap: anywhere; }
.operation-row span { text-align: right; }
@media (max-width: 1100px) { .operations-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .operations-grid { gap: 8px; } .operation-card { padding: 14px 12px; } .operation-card strong { font-size: 26px; } .operation-card strong.pressure-value { font-size: 17px; } .operation-row { flex-direction: column; gap: 6px; } .operation-row span { text-align: left; } }
</style>
