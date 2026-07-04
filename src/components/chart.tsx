// Shared monochrome chart tokens + a Base-Web-styled Recharts tooltip.
// Used by Trends and Body so chart styling has one source of truth (no hardcoded hex per call site).
export const CHART = { ink: '#000000', mid: '#4b4b4b', mute: '#afafaf', grid: '#efefef' }
export const AXIS = { fontSize: 11, fill: CHART.mute }
export const TOOLTIP = {
  contentStyle: { fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, border: '1px solid #e2e2e2', borderRadius: 8, boxShadow: 'none', padding: '6px 10px' },
  labelStyle: { color: '#5e5e5e', marginBottom: 2, fontSize: 11 },
  itemStyle: { color: '#000000', padding: 0 },
  cursor: { stroke: '#e2e2e2', strokeWidth: 1 },
}
