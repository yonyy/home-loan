import type { ScenarioResult } from '../types/loan.types';
import { formatCurrency, formatPayoffDate, monthsToHumanDuration } from '../logic/dateUtils';
import { SCENARIO_COLORS } from '../logic/chartUtils';

interface Props {
  scenarios: ScenarioResult[];
  armBaselineInterest: number;
  armBaselineMonths: number;
}

interface MetricRow {
  label: string;
  getValue: (s: ScenarioResult) => string;
  getBest: (values: number[]) => number;  // index of best value
  toNumber: (s: ScenarioResult) => number;
  highlight: 'high' | 'low' | 'none'; // whether higher or lower is better
}

function cellColor(isBest: boolean, isWorst: boolean): string {
  if (isBest) return 'rgba(76, 175, 80, 0.15)';
  if (isWorst) return 'rgba(224, 82, 82, 0.10)';
  return 'transparent';
}

export function ComparisonMatrix({ scenarios, armBaselineInterest, armBaselineMonths }: Props) {
  const metrics: MetricRow[] = [
    {
      label: 'Monthly Payment',
      getValue: s => {
        const firstRow = s.schedule[0];
        return firstRow ? formatCurrency(firstRow.borrowerPayment) : '—';
      },
      toNumber: s => s.schedule[0]?.borrowerPayment ?? 0,
      getBest: vals => vals.indexOf(Math.min(...vals)),
      highlight: 'low',
    },
    {
      label: 'Headroom Yr 1 avg',
      getValue: s => {
        const yr1 = s.schedule.filter(r => r.annualRate < 0.05);
        const avg = yr1.reduce((a, r) => a + r.headroom, 0) / (yr1.length || 1);
        return formatCurrency(avg);
      },
      toNumber: s => {
        const yr1 = s.schedule.filter(r => r.annualRate < 0.05);
        return yr1.reduce((a, r) => a + r.headroom, 0) / (yr1.length || 1);
      },
      getBest: vals => vals.indexOf(Math.max(...vals)),
      highlight: 'high',
    },
    {
      label: 'Months to Payoff',
      getValue: s => `${s.monthsToPayoff} (${monthsToHumanDuration(s.monthsToPayoff)})`,
      toNumber: s => s.monthsToPayoff,
      getBest: vals => vals.indexOf(Math.min(...vals)),
      highlight: 'low',
    },
    {
      label: 'Payoff Date',
      getValue: s => formatPayoffDate(s.payoffDate),
      toNumber: s => s.monthsToPayoff,
      getBest: vals => vals.indexOf(Math.min(...vals)),
      highlight: 'low',
    },
    {
      label: 'Total Interest',
      getValue: s => formatCurrency(s.totalInterest),
      toNumber: s => s.totalInterest,
      getBest: vals => vals.indexOf(Math.min(...vals)),
      highlight: 'low',
    },
    {
      label: 'Total Borrower Payments',
      getValue: s => formatCurrency(s.totalPayments),
      toNumber: s => s.totalPayments,
      getBest: vals => vals.indexOf(Math.min(...vals)),
      highlight: 'low',
    },
    {
      label: 'Extra Principal Paid',
      getValue: s => s.totalExtraPrincipal > 0 ? formatCurrency(s.totalExtraPrincipal) : '—',
      toNumber: s => s.totalExtraPrincipal,
      getBest: vals => vals.indexOf(Math.max(...vals)),
      highlight: 'none',
    },
    {
      label: 'Lender Subsidy',
      getValue: s => s.totalBuydownSubsidy > 0 ? formatCurrency(s.totalBuydownSubsidy) : '—',
      toNumber: s => s.totalBuydownSubsidy,
      getBest: vals => vals.indexOf(Math.max(...vals)),
      highlight: 'none',
    },
    {
      label: 'Interest Saved vs Base',
      getValue: s => {
        const saved = s.interestSavedVsARM;
        return (saved >= 0 ? '+' : '') + formatCurrency(saved);
      },
      toNumber: s => s.interestSavedVsARM,
      getBest: vals => vals.indexOf(Math.max(...vals)),
      highlight: 'high',
    },
    {
      label: 'Months Saved vs Base',
      getValue: s => `${s.monthsSavedVsARM > 0 ? '-' : '+'}${Math.abs(s.monthsSavedVsARM)}mo`,
      toNumber: s => s.monthsSavedVsARM,
      getBest: vals => vals.indexOf(Math.max(...vals)),
      highlight: 'high',
    },
  ];

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'center' as const,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap' as const,
    minWidth: 120,
  };

  const tdStyle: React.CSSProperties = {
    padding: '7px 12px',
    textAlign: 'center' as const,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    borderBottom: '1px solid var(--color-border)',
  };

  return (
    <div style={{ overflowX: 'auto', padding: 'var(--spacing-md)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>Metric</th>
            {scenarios.map(s => (
              <th key={s.scenarioType} style={thStyle}>
                <span style={{ color: SCENARIO_COLORS[s.scenarioType] ?? '#4f86f7' }}>●</span>
                {' '}{s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map(metric => {
            const values = scenarios.map(s => metric.toNumber(s));
            const bestIdx = metric.getBest(values);
            const worstIdx = metric.highlight !== 'none'
              ? (metric.highlight === 'high'
                ? values.indexOf(Math.min(...values))
                : values.indexOf(Math.max(...values)))
              : -1;

            return (
              <tr key={metric.label}>
                <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--color-text-muted)', fontFamily: 'var(--font-sans)' }}>
                  {metric.label}
                </td>
                {scenarios.map((s, i) => (
                  <td
                    key={s.scenarioType}
                    style={{
                      ...tdStyle,
                      background: cellColor(i === bestIdx && metric.highlight !== 'none', i === worstIdx && metric.highlight !== 'none'),
                      color: i === bestIdx && metric.highlight !== 'none'
                        ? 'var(--color-accent-green)'
                        : i === worstIdx && metric.highlight !== 'none'
                          ? 'var(--color-accent-red)'
                          : 'var(--color-text-primary)',
                    }}
                  >
                    {metric.getValue(s)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-dim)' }}>
        Base = ARM minimum payment only ({armBaselineMonths}mo, {formatCurrency(armBaselineInterest)} interest).
        Green = best value in row. Red = worst.
      </div>
    </div>
  );
}
