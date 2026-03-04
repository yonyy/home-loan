import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';
import type { ScenarioResult, LoanInputs } from '../../types/loan.types';
import { formatDollarAxis, buildBreakdownData } from '../../logic/chartUtils';
import { ChartTooltip } from '../ChartTooltip';
import { monthToCalendarDate, formatShortDate } from '../../logic/dateUtils';

interface Props {
  scenario: ScenarioResult;
  inputs: LoanInputs;
}

export function HeadroomChart({ scenario, inputs }: Props) {
  const sampleRate = Math.max(1, Math.floor(scenario.schedule.length / 80));
  const data = scenario.schedule
    .filter((_, i) => i % sampleRate === 0)
    .map(row => ({
      month: row.month,
      label: formatShortDate(monthToCalendarDate(row.month, inputs.loanStartMonth, inputs.loanStartYear)),
      headroom: Math.round(row.headroom),
    }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8891a8', fontSize: 10 }}
          interval={Math.floor(data.length / 8)}
        />
        <YAxis
          tickFormatter={formatDollarAxis}
          tick={{ fill: '#8891a8', fontSize: 10 }}
          width={55}
        />
        <Tooltip content={<ChartTooltip />} />
        <ReferenceLine y={0} stroke="#4f86f7" strokeDasharray="3 3" />
        <Bar dataKey="headroom" name="Headroom" maxBarSize={12}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.headroom >= 0 ? '#4caf50' : '#e05252'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
