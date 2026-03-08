import type { AmortizationRow, ScenarioResult } from '../types/loan.types';
import { monthToCalendarDate, formatShortDate } from './dateUtils';

export function scheduleToCSV(
  schedule: AmortizationRow[],
  loanStartMonth: number,
  loanStartYear: number
): string {
  const headers = [
    'Month', 'Date', 'Annual Rate', 'Standard Pmt', 'Interest',
    'Principal', 'Extra Principal', 'Escrow', 'Total Payment',
    'Lender Subsidy', 'Headroom', 'Remaining Balance',
  ];

  const rows = schedule.map(r => {
    const date = formatShortDate(monthToCalendarDate(r.month, loanStartMonth, loanStartYear));
    return [
      r.month,
      date,
      (r.annualRate * 100).toFixed(3) + '%',
      r.standardPayment.toFixed(2),
      r.interest.toFixed(2),
      r.principal.toFixed(2),
      r.extraPrincipal.toFixed(2),
      r.escrow.toFixed(2),
      r.borrowerPayment.toFixed(2),
      r.buydownSubsidy.toFixed(2),
      r.headroom.toFixed(2),
      r.remainingBalance.toFixed(2),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function downloadCSV(filename: string, csvString: string): void {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function scenarioSummaryToJSON(result: ScenarioResult): string {
  return JSON.stringify({
    scenario: result.label,
    monthsToPayoff: result.monthsToPayoff,
    payoffDate: result.payoffDate.toISOString().slice(0, 7),
    totalInterest: Math.round(result.totalInterest),
    totalPayments: Math.round(result.totalPayments),
    totalExtraPrincipal: Math.round(result.totalExtraPrincipal),
    totalBuydownSubsidy: Math.round(result.totalBuydownSubsidy),
    interestSavedVsARM: Math.round(result.interestSavedVsARM),
    monthsSavedVsARM: result.monthsSavedVsARM,
    avgMonthlyHeadroom: Math.round(result.avgMonthlyHeadroom),
  }, null, 2);
}
