import type { ScenarioResult } from '../types/loan.types';
import { monthToCalendarDate, formatShortDate } from './dateUtils';

export interface ChartDataPoint {
  month: number;
  label: string;
  [key: string]: number | string;
}

/**
 * Merges all scenario schedules onto a common month axis.
 * Each point has the balance for every scenario keyed by scenarioType.
 */
export function mergeSchedulesToMonthAxis(
  scenarios: ScenarioResult[],
  loanStartMonth: number,
  loanStartYear: number
): ChartDataPoint[] {
  if (!scenarios.length) return [];

  const maxMonth = Math.max(...scenarios.map(s => {
    const last = s.schedule[s.schedule.length - 1];
    return last ? last.month : 0;
  }));

  const startMonth = scenarios[0]?.schedule[0]?.month ?? 1;

  const points: ChartDataPoint[] = [];
  for (let m = startMonth; m <= maxMonth; m++) {
    const date = monthToCalendarDate(m, loanStartMonth, loanStartYear);
    const point: ChartDataPoint = { month: m, label: formatShortDate(date) };
    for (const s of scenarios) {
      const row = s.schedule.find(r => r.month === m);
      point[s.scenarioType] = row ? row.remainingBalance : 0;
      point[`${s.scenarioType}_interest`] = row ? row.interest : 0;
      point[`${s.scenarioType}_headroom`] = row ? row.headroom : 0;
      point[`${s.scenarioType}_cumInterest`] = 0; // filled below
    }
    points.push(point);
  }

  // Fill cumulative interest
  for (const s of scenarios) {
    let cumInterest = 0;
    for (const point of points) {
      const row = s.schedule.find(r => r.month === point.month);
      if (row) cumInterest += row.interest;
      point[`${s.scenarioType}_cumInterest`] = cumInterest;
    }
  }

  return points;
}

/**
 * Build data for payment breakdown stacked area chart for a single scenario.
 */
export function buildBreakdownData(
  scenario: ScenarioResult,
  loanStartMonth: number,
  loanStartYear: number
): { month: number; label: string; interest: number; principal: number; extra: number; escrow: number }[] {
  return scenario.schedule.map(row => ({
    month: row.month,
    label: formatShortDate(monthToCalendarDate(row.month, loanStartMonth, loanStartYear)),
    interest: Math.round(row.interest),
    principal: Math.round(row.principal),
    extra: Math.round(row.extraPrincipal),
    escrow: Math.round(row.escrow),
  }));
}

export function formatDollarAxis(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

/** Returns the month numbers where ARM rate changes occur */
export function getARMRateCliffMonths(
  startMonth: number,
  year1Duration: number,
  year2Duration: number
): number[] {
  return [
    startMonth <= year1Duration ? year1Duration : -1,
    startMonth <= year1Duration + year2Duration ? year1Duration + year2Duration : -1,
  ].filter(m => m > 0 && m >= startMonth);
}

export const SCENARIO_COLORS: Record<string, string> = {
  ARM_FIXED_PAYMENT: '#4f86f7',
  ARM_QUARTERLY_EXTRA: '#4caf50',
  REFI_30YR_FIXED: '#f5a623',
  REFI_15YR_MIN: '#ab6bf7',
  BUYDOWN_2_1: '#e05252',
  FIXED_RATE_NORMAL: '#8891a8',
};
