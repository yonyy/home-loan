import type { ScenarioResult } from '../types/loan.types';
import type { DerivedValues } from '../hooks/useDerivedValues';
import { SummaryCard } from './SummaryCard';
import { formatCurrency, formatPayoffDate, monthsToHumanDuration, formatRate } from '../logic/dateUtils';

interface HeaderProps {
  activeScenario: ScenarioResult;
  derived: DerivedValues;
}

export function Header({ activeScenario, derived }: HeaderProps) {
  const { totalInterest, monthsToPayoff, payoffDate, avgMonthlyHeadroom } = activeScenario;

  return (
    <header className="app-header">
      <div style={{ display: 'flex', flexDirection: 'column', width: 140, flexShrink: 0, overflow: 'hidden' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-accent-blue)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
          HomeLoan
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatCurrency(derived.effectiveBalance, true)} · Mo {activeScenario.schedule[0]?.month ?? '—'} · Yr{derived.currentARMYear} {formatRate(derived.currentARMRate)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 0, flex: 1, overflowX: 'auto' }}>
        <SummaryCard
          label="Payoff Date"
          value={formatPayoffDate(payoffDate)}
          sub={monthsToHumanDuration(monthsToPayoff)}
        />
        <SummaryCard
          label="Total Interest"
          value={formatCurrency(totalInterest)}
          sub={`${formatCurrency(activeScenario.interestSavedVsARM, true)} vs base`}
        />
        <SummaryCard
          label="Months Left"
          value={String(monthsToPayoff)}
          sub={`${activeScenario.monthsSavedVsARM > 0 ? '-' : '+'}${Math.abs(activeScenario.monthsSavedVsARM)}mo vs base`}
        />
        <SummaryCard
          label="Headroom"
          value={formatCurrency(avgMonthlyHeadroom)}
          sub="avg monthly"
        />
        {activeScenario.totalBuydownSubsidy > 0 && (
          <SummaryCard
            label="Lender Subsidy"
            value={formatCurrency(activeScenario.totalBuydownSubsidy)}
            sub="total buydown value"
          />
        )}
      </div>
    </header>
  );
}
