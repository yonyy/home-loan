import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import type { ScenarioResult, LoanInputs } from '../../types/loan.types';
import { mergeSchedulesToMonthAxis, formatDollarAxis, SCENARIO_COLORS } from '../../logic/chartUtils';
import { ChartTooltip } from '../ChartTooltip';

interface Props {
  scenarios: ScenarioResult[];
  inputs: LoanInputs;
}

export function InterestCumulativeChart({ scenarios, inputs }: Props) {
  const data = mergeSchedulesToMonthAxis(scenarios, inputs.loanStartMonth, inputs.loanStartYear);
  const sampleRate = Math.max(1, Math.floor(data.length / 120));
  const sampled = data.filter((_, i) => i % sampleRate === 0 || i === data.length - 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={sampled} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
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
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#8891a8' }}
          formatter={(value) => {
            const type = (value as string).replace('_cumInterest', '');
            return scenarios.find(s => s.scenarioType === type)?.label ?? type;
          }}
        />

        {scenarios.map(s => (
          <Line
            key={s.scenarioType}
            type="monotone"
            dataKey={`${s.scenarioType}_cumInterest`}
            name={`${s.scenarioType}_cumInterest`}
            stroke={SCENARIO_COLORS[s.scenarioType] ?? '#4f86f7'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
