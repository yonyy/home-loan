import { formatDollarAxis } from '../logic/chartUtils';

interface TooltipPayloadItem {
  name: string;
  value: number;
  color?: string;
  dataKey?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  formatter?: (value: number, name: string) => string;
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: '#1c1f2e',
      border: '1px solid #2a2d3e',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      fontFamily: 'monospace',
    }}>
      <div style={{ color: '#8891a8', marginBottom: 4 }}>{label}</div>
      {payload.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8,
            borderRadius: '50%', background: item.color ?? '#4f86f7', flexShrink: 0,
          }} />
          <span style={{ color: '#8891a8', flex: 1 }}>{item.name}</span>
          <span style={{ color: '#e8eaf0', fontWeight: 600 }}>
            {formatter ? formatter(item.value, item.name) : formatDollarAxis(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
