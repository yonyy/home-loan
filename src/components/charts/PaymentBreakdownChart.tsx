import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import type { ScenarioResult, LoanInputs } from '../../types/loan.types';
import { buildBreakdownData, formatDollarAxis } from '../../logic/chartUtils';
import { ChartTooltip } from '../ChartTooltip';

interface Props {
  scenario: ScenarioResult;
  inputs: LoanInputs;
}

export function PaymentBreakdownChart({ scenario, inputs }: Props) {
  const data = buildBreakdownData(scenario, inputs.loanStartMonth, inputs.loanStartYear);
  const sampleRate = Math.max(1, Math.floor(data.length / 120));
  const sampled = data.filter((_, i) => i % sampleRate === 0 || i === data.length - 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={sampled} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8891a8', fontSize: 10 }}
          interval={Math.floor(sampled.length / 8)}
        />
        <YAxis
          tickFormatter={formatDollarAxis}
          tick={{ fill: '#8891a8', fontSize: 10 }}
          width={55}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#8891a8' }} />

        <Area type="monotone" dataKey="escrow" name="Escrow" stackId="1"
          fill="#565e7a" stroke="#565e7a" fillOpacity={0.8} />
        <Area type="monotone" dataKey="interest" name="Interest" stackId="1"
          fill="#e05252" stroke="#e05252" fillOpacity={0.8} />
        <Area type="monotone" dataKey="principal" name="Principal" stackId="1"
          fill="#4f86f7" stroke="#4f86f7" fillOpacity={0.8} />
        {scenario.totalExtraPrincipal > 0 && (
          <Area type="monotone" dataKey="extra" name="Extra Principal" stackId="1"
            fill="#4caf50" stroke="#4caf50" fillOpacity={0.8} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
