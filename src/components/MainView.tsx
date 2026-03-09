import { useState } from 'react';
import type { ScenarioResult, AmortizationRow, LoanInputs } from '../types/loan.types';
import { formatCurrency, formatRate, monthToCalendarDate, formatShortDate } from '../logic/dateUtils';
import { BalanceOverTimeChart } from './charts/BalanceOverTimeChart';
import { PaymentBreakdownChart } from './charts/PaymentBreakdownChart';
import { HeadroomChart } from './charts/HeadroomChart';
import { InterestCumulativeChart } from './charts/InterestCumulativeChart';
import { ComparisonMatrix } from './ComparisonMatrix';
import { ExportButton } from './ExportButton';

interface MainViewProps {
  scenarios: ScenarioResult[];
  inputs: LoanInputs;
  armBaselineInterest: number;
  armBaselineMonths: number;
}

type ChartTab = 'balance' | 'breakdown' | 'headroom' | 'cumInterest';
type MainTab = 'charts' | 'compare';

function getArmYear(month: number, year1Duration: number, year2Duration: number): 1 | 2 | 3 {
  if (month <= year1Duration) return 1;
  if (month <= year1Duration + year2Duration) return 2;
  return 3;
}

function AmortTable({ scenario, inputs }: { scenario: ScenarioResult; inputs: LoanInputs }) {
  const { year1DurationMonths, year2DurationMonths } = inputs.armRates;
  const [advanced, setAdvanced] = useState(false);
  const hasBuydown = scenario.totalBuydownSubsidy > 0;

  return (
    <div className="amort-table-wrapper">
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 4px' }}>
        <button
          onClick={() => setAdvanced(v => !v)}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: advanced ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          {advanced ? 'Simple View' : 'Advanced View'}
        </button>
      </div>
      <table className="amort-table">
        <thead>
          <tr>
            {advanced && <th>Month</th>}
            <th>Due Date</th>
            {advanced && <th>Rate</th>}
            <th>Standard Payment</th>
            <th>Interest</th>
            {advanced && <th>Escrow</th>}
            <th>Principal</th>
            {advanced && <th>Overpayment</th>}
            {advanced && <th>Total Principal</th>}
            {advanced && <th>Total Payment</th>}
            {advanced && hasBuydown && <th>Subsidy</th>}
            {advanced && <th>Headroom</th>}
            <th>Remaining Balance</th>
            {advanced && <th>% Paid Off</th>}
          </tr>
        </thead>
        <tbody>
          {scenario.schedule.map((row: AmortizationRow) => {
            const armYear = getArmYear(row.month, year1DurationMonths, year2DurationMonths);
            const yearClass = `year${armYear}`;
            const date = monthToCalendarDate(row.month, inputs.loanStartMonth, inputs.loanStartYear);
            const paidOffPct = ((inputs.originalPrincipal - row.remainingBalance) / inputs.originalPrincipal * 100).toFixed(1) + '%';

            return (
              <tr key={row.month} className={row.isQuarterlyPaymentMonth ? 'quarterly-row' : ''}>
                {advanced && <td className={yearClass}>{row.month}</td>}
                <td style={{ color: 'var(--color-text-muted)' }}>{formatShortDate(date)}</td>
                {advanced && <td className={yearClass}>{formatRate(row.annualRate)}</td>}
                <td style={{ color: 'var(--color-text-dim)' }}>{formatCurrency(row.standardPayment)}</td>
                <td>{formatCurrency(row.interest)}</td>
                {advanced && <td style={{ color: 'var(--color-text-dim)' }}>{formatCurrency(row.escrow)}</td>}
                <td>{formatCurrency(row.principal)}</td>
                {advanced && (
                  <td style={{ color: row.extraPrincipal > 0 ? 'var(--color-accent-blue)' : 'var(--color-text-dim)' }}>
                    {row.extraPrincipal > 0 ? formatCurrency(row.extraPrincipal) : '—'}
                  </td>
                )}
                {advanced && <td>{formatCurrency(row.totalPrincipalPaid)}</td>}
                {advanced && <td>{formatCurrency(row.borrowerPayment)}</td>}
                {advanced && hasBuydown && (
                  <td style={{ color: 'var(--color-accent-green)' }}>
                    {row.buydownSubsidy > 0 ? formatCurrency(row.buydownSubsidy) : '—'}
                  </td>
                )}
                {advanced && (
                  <td className={row.headroom < 0 ? 'negative' : row.headroom > 500 ? 'positive' : ''}>
                    {formatCurrency(row.headroom)}
                  </td>
                )}
                <td>{formatCurrency(row.remainingBalance)}</td>
                {advanced && <td style={{ color: 'var(--color-text-muted)' }}>{paidOffPct}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CHART_TABS: { id: ChartTab; label: string }[] = [
  { id: 'balance', label: 'Balance Over Time' },
  { id: 'breakdown', label: 'Payment Breakdown' },
  { id: 'headroom', label: 'Headroom' },
  { id: 'cumInterest', label: 'Cumulative Interest' },
];

const tabBtn = (active: boolean) => ({
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  background: active ? 'var(--color-bg)' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--color-accent-blue)' : '2px solid transparent',
  color: active ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
  cursor: 'pointer',
  marginBottom: -1,
} as React.CSSProperties);

const subTabBtn = (active: boolean) => ({
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  border: 'none',
  color: active ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
  cursor: 'pointer',
  borderBottom: active ? '2px solid var(--color-accent-blue)' : '2px solid transparent',
  marginBottom: -1,
} as React.CSSProperties);

export function MainView({ scenarios, inputs, armBaselineInterest, armBaselineMonths }: MainViewProps) {
  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [activeChart, setActiveChart] = useState<ChartTab>('balance');
  const [mainTab, setMainTab] = useState<MainTab>('charts');
  const activeScenario = scenarios[activeScenarioIdx] ?? scenarios[0];

  return (
    <div>
      {/* Main tabs: Charts / Compare */}
      <div style={{
        display: 'flex',
        gap: 0,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: 'var(--spacing-sm) var(--spacing-md) 0',
      }}>
        <button style={tabBtn(mainTab === 'charts')} onClick={() => setMainTab('charts')}>Charts & Schedule</button>
        <button style={tabBtn(mainTab === 'compare')} onClick={() => setMainTab('compare')}>Comparison</button>
      </div>

      {mainTab === 'compare' ? (
        <ComparisonMatrix
          scenarios={scenarios}
          armBaselineInterest={armBaselineInterest}
          armBaselineMonths={armBaselineMonths}
        />
      ) : (
        <>
          {/* Scenario tabs */}
          <div className="scenario-tabs">
            {scenarios.map((s, i) => (
              <button
                key={s.scenarioType}
                className={`scenario-tab${i === activeScenarioIdx ? ' scenario-tab--active' : ''}`}
                onClick={() => setActiveScenarioIdx(i)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Chart section */}
          <div style={{ background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: 1 }}>
                {CHART_TABS.map(tab => (
                  <button key={tab.id} onClick={() => setActiveChart(tab.id)} style={subTabBtn(activeChart === tab.id)}>
                    {tab.label}
                  </button>
                ))}
              </div>
              {activeScenario && <ExportButton scenario={activeScenario} inputs={inputs} />}
            </div>

            <div style={{ padding: '16px 8px 8px' }}>
              {activeChart === 'balance' && <BalanceOverTimeChart scenarios={scenarios} inputs={inputs} />}
              {activeChart === 'breakdown' && activeScenario && <PaymentBreakdownChart scenario={activeScenario} inputs={inputs} />}
              {activeChart === 'headroom' && activeScenario && <HeadroomChart scenario={activeScenario} inputs={inputs} />}
              {activeChart === 'cumInterest' && <InterestCumulativeChart scenarios={scenarios} inputs={inputs} />}
            </div>
          </div>

          {/* Amortization table */}
          {activeScenario && <AmortTable scenario={activeScenario} inputs={inputs} />}
        </>
      )}
    </div>
  );
}
