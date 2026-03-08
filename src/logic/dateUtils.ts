/**
 * Convert an absolute loan month to a calendar Date.
 * loanStartMonth is 1-based (1 = Jan, 5 = May).
 * absoluteMonth = months elapsed since origination (month 1 = first month of loan).
 */
export function monthToCalendarDate(
  absoluteMonth: number,
  loanStartMonth: number,
  loanStartYear: number
): Date {
  // month 1 of loan = loanStartYear + loanStartMonth - 1 (0-based)
  const totalMonths = loanStartYear * 12 + (loanStartMonth - 1) + (absoluteMonth - 1);
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  return new Date(year, month, 1);
}

export function formatPayoffDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function monthsToHumanDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}mo`;
  if (m === 0) return `${y}yr`;
  return `${y}yr ${m}mo`;
}

export function formatCurrency(n: number, compact = false): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatRate(r: number): string {
  return `${(r * 100).toFixed(3)}%`;
}
