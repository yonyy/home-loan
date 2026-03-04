import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend, ResponsiveContainer,
} from 'recharts';
import type { ScenarioResult, LoanInputs } from '../../types/loan.types';
import { mergeSchedulesToMonthAxis, formatDollarAxis, getARMRateCliffMonths, SCENARIO_COLORS } from '../../logic/chartUtils';
import { ChartTooltip } from '../ChartTooltip';

interface Props {
  scenarios: ScenarioResult[];
  inputs: LoanInputs;
}

export function BalanceOverTimeChart({ scenarios, inputs }: Props) {
  const data = mergeSchedulesToMonthAxis(scenarios, inputs.loanStartMonth, inputs.loanStartYear);
  const cliffs = getARMRateCliffMonths(
    inputs.currentMonth,
    inputs.armRates.year1DurationMonths,
    inputs.armRates.year2DurationMonths
  );

  // Sample every N months to keep chart responsive
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
          formatter={(value) => scenarios.find(s => s.scenarioType === value)?.label ?? value}
        />

        {cliffs.map((m, i) => (
          <ReferenceLine
            key={m}
            x={sampled.find(d => d.month >= m)?.label}
            stroke={i === 0 ? '#f5a623' : '#e05252'}
            strokeDasharray="4 4"
            label={{ value: i === 0 ? 'Yr2' : 'Yr3+', fill: i === 0 ? '#f5a623' : '#e05252', fontSize: 10 }}
          />
        ))}

        {/* Today marker */}
        <ReferenceLine
          x={sampled.find(d => d.month >= inputs.currentMonth)?.label}
          stroke="#4f86f7"
          strokeDasharray="2 4"
          label={{ value: 'Now', fill: '#4f86f7', fontSize: 10 }}
        />

        {scenarios.map(s => (
          <Line
            key={s.scenarioType}
            type="monotone"
            dataKey={s.scenarioType}
            name={s.scenarioType}
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
