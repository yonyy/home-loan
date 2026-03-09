export interface AmortSummary {
  id: string;
  totalInterest: number;
  headroom: number;
  monthsToPayoff: number;
  minPayment: number;
}

export interface Winners {
  lowestInterest: string;
  mostHeadroom: string;
  fastestPayoff: string;
}

export function computeWinners(amorts: AmortSummary[]): Winners | null {
  if (amorts.length < 2) return null;
  return {
    lowestInterest: amorts.reduce((a, b) => a.totalInterest < b.totalInterest ? a : b).id,
    mostHeadroom:   amorts.reduce((a, b) => a.headroom > b.headroom ? a : b).id,
    fastestPayoff:  amorts.reduce((a, b) => a.monthsToPayoff < b.monthsToPayoff ? a : b).id,
  };
}

function fmt$(v: number): string {
  return "$" + Math.round(Math.abs(v)).toLocaleString();
}

function fmtYrs(months: number): string {
  const y = Math.round(months / 12 * 10) / 10;
  return y + " yr" + (y !== 1 ? "s" : "");
}

/**
 * Generate a one-line trade-off sentence for a single scenario relative to the others.
 * Always returns a non-empty string. Max ~14 words.
 */
export function generateTradeoff(
  a: AmortSummary,
  all: AmortSummary[],
  winners: Winners | null
): string {
  if (all.length < 2 || !winners) {
    return "Add a second strategy to see trade-offs.";
  }

  const worstInterest = Math.max(...all.map(x => x.totalInterest));
  const bestInterest  = Math.min(...all.map(x => x.totalInterest));
  const bestHeadroom  = Math.max(...all.map(x => x.headroom));
  const fastestPayoff = Math.min(...all.map(x => x.monthsToPayoff));
  const slowestPayoff = Math.max(...all.map(x => x.monthsToPayoff));

  // Priority 1: if this is the lowest interest winner
  if (a.id === winners.lowestInterest) {
    const saved = worstInterest - a.totalInterest;
    if (saved > 500) return `Saves ${fmt$(saved)} in total interest vs worst case.`;
  }

  // Priority 2: if this is the most headroom winner
  if (a.id === winners.mostHeadroom) {
    const others = all.filter(x => x.id !== a.id);
    const nextBest = Math.max(...others.map(x => x.headroom));
    const delta = a.headroom - nextBest;
    if (delta > 50) return `${fmt$(delta)}/mo more flexibility than the next option.`;
  }

  // Priority 3: if this is the fastest payoff winner
  if (a.id === winners.fastestPayoff) {
    const delta = slowestPayoff - a.monthsToPayoff;
    if (delta >= 12) return `Pays off ${fmtYrs(delta)} sooner than the slowest option.`;
  }

  // Fallback: show relative positioning
  const interestDelta = a.totalInterest - bestInterest;
  const headroomDelta = bestHeadroom - a.headroom;

  if (interestDelta > 500 && headroomDelta < 0) {
    return `${fmt$(interestDelta)} more in interest, but ${fmt$(-headroomDelta)}/mo more flexibility.`;
  }
  if (interestDelta > 500) {
    return `${fmt$(interestDelta)} more in interest than the lowest-cost option.`;
  }
  if (headroomDelta > 50) {
    return `${fmt$(headroomDelta)}/mo less flexibility than the best headroom option.`;
  }

  const payoffDelta = a.monthsToPayoff - fastestPayoff;
  if (payoffDelta >= 12) {
    return `Pays off ${fmtYrs(payoffDelta)} later than the fastest option.`;
  }

  return "Comparable across all metrics.";
}
