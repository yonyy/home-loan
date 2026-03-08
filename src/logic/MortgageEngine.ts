import type {
  LoanInputs,
  ARMRateSchedule,
  StandardPayments,
  AmortizationRow,
  ScenarioResult,
  ScenarioType,
  ComparisonMatrix,
  InvestmentProjection,
  BuydownConfig,
} from '../types/loan.types';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard amortization formula: P*r*(1+r)^n / ((1+r)^n - 1)
 * Ports: calculate_fixed_pi() from mortgage_strategy_engine.py
 */
export function calculateFixedPI(
  principal: number,
  annualRate: number,
  termYears: number
): number {
  const r = annualRate / 12;
  const n = termYears * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/**
 * Returns the monthly rate for a given absolute loan month.
 * Uses configurable year durations (not hardcoded 12/24).
 * Ports: arm_rate_logic() from mortgage_strategy_engine.py
 */
export function getARMMonthlyRate(month: number, armRates: ARMRateSchedule): number {
  const { year1Rate, year2Rate, year3PlusRate, year1DurationMonths, year2DurationMonths } = armRates;
  if (month <= year1DurationMonths) return year1Rate / 12;
  if (month <= year1DurationMonths + year2DurationMonths) return year2Rate / 12;
  return year3PlusRate / 12;
}

/**
 * Returns the standard P+I payment for a given month based on ARM year.
 */
export function getStandardPI(month: number, std: StandardPayments, armRates: ARMRateSchedule): number {
  const { year1DurationMonths, year2DurationMonths } = armRates;
  if (month <= year1DurationMonths) return std.year1;
  if (month <= year1DurationMonths + year2DurationMonths) return std.year2;
  return std.year3Plus;
}

/**
 * Resolves effective standard payments — auto-calculated or user-provided.
 */
export function resolveStandardPayments(inputs: LoanInputs): StandardPayments {
  if (!inputs.standardPayments.useAutoCalculate) return inputs.standardPayments;
  return {
    year1: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year1Rate, inputs.originalTermYears),
    year2: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year2Rate, inputs.originalTermYears),
    year3Plus: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year3PlusRate, inputs.originalTermYears),
    useAutoCalculate: true,
  };
}

/**
 * Walks the amortization from month 1 to find the balance at a given month.
 * Used when balanceIsManualOverride = false.
 */
export function calculateBalanceAtMonth(
  originalPrincipal: number,
  targetMonth: number,
  armRates: ARMRateSchedule,
  std: StandardPayments
): number {
  let balance = originalPrincipal;
  for (let m = 1; m < targetMonth; m++) {
    const rate = getARMMonthlyRate(m, armRates);
    const interest = balance * rate;
    const pi = getStandardPI(m, std, armRates);
    const principal = pi - interest;
    balance -= Math.max(0, principal);
    if (balance <= 0) return 0;
  }
  return Math.max(0, balance);
}

/**
 * Compound monthly investment projection.
 * monthlyRate = (1 + annualRate)^(1/12) - 1
 * Ports: investment projection loops from updated_investment_analysis.py
 */
export function projectInvestment(
  monthlyContribution: number,
  numMonths: number,
  annualReturnRate: number
): number {
  const monthlyRate = Math.pow(1 + annualReturnRate, 1 / 12) - 1;
  let fv = 0;
  for (let k = 0; k < numMonths; k++) {
    fv = fv * (1 + monthlyRate) + monthlyContribution;
  }
  return fv;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core ARM simulation with a fixed target monthly payment.
 * Interest accrues at the ARM rate each month.
 * Ports: simulate_payoff_with_fixed_payment() from 6k_payment_analysis.py
 *        and simulate_mortgage() from mortgage_strategy_engine.py
 */
export function simulateARM(inputs: LoanInputs): AmortizationRow[] {
  const std = resolveStandardPayments(inputs);
  const effectiveBalance = inputs.balanceIsManualOverride
    ? inputs.currentBalance
    : calculateBalanceAtMonth(inputs.originalPrincipal, inputs.currentMonth, inputs.armRates, std);

  const rows: AmortizationRow[] = [];
  let balance = effectiveBalance;
  let month = inputs.currentMonth;
  const MAX_MONTHS = 480; // 40-year safety cap

  while (balance > 0.005 && rows.length < MAX_MONTHS) {
    const rate = getARMMonthlyRate(month, inputs.armRates);
    const interest = balance * rate;
    const stdPI = getStandardPI(month, std, inputs.armRates);
    const standardPayment = stdPI + inputs.escrow;

    let principal = inputs.targetMonthlyPayment - inputs.escrow - interest;

    // Final payment adjustment
    if (principal >= balance) {
      principal = balance;
    } else if (principal < 0) {
      principal = 0;
    }

    const totalPrincipalPaid = principal;
    const totalPayment = interest + principal + inputs.escrow;
    const newBalance = balance - principal;
    const headroom = totalPayment - standardPayment;

    rows.push({
      month,
      annualRate: rate * 12,
      standardPayment,
      interest,
      principal,
      extraPrincipal: Math.max(0, headroom),
      escrow: inputs.escrow,
      totalPrincipalPaid,
      totalPayment,
      borrowerPayment: totalPayment,
      buydownSubsidy: 0,
      headroom,
      remainingBalance: newBalance,
      isQuarterlyPaymentMonth: false,
    });

    balance = newBalance;
    month++;
  }

  return rows;
}

/**
 * ARM simulation with periodic extra principal payments.
 * Ports: simulate_payoff_with_quarterly_payments() from 6k_plus_13k_analysis.py
 */
export function simulateARMWithQuarterly(inputs: LoanInputs): AmortizationRow[] {
  const std = resolveStandardPayments(inputs);
  const effectiveBalance = inputs.balanceIsManualOverride
    ? inputs.currentBalance
    : calculateBalanceAtMonth(inputs.originalPrincipal, inputs.currentMonth, inputs.armRates, std);

  const rows: AmortizationRow[] = [];
  let balance = effectiveBalance;
  let month = inputs.currentMonth;
  const MAX_MONTHS = 480;

  // Build the set of quarterly payment months
  const { enabled, amount, intervalMonths, firstPaymentMonth } = inputs.quarterly;

  while (balance > 0.005 && rows.length < MAX_MONTHS) {
    const rate = getARMMonthlyRate(month, inputs.armRates);
    const interest = balance * rate;
    const stdPI = getStandardPI(month, std, inputs.armRates);
    const standardPayment = stdPI + inputs.escrow;

    let principal = inputs.targetMonthlyPayment - inputs.escrow - interest;
    if (principal < 0) principal = 0;

    // Quarterly extra principal
    const isQuarterly = enabled
      && month >= firstPaymentMonth
      && ((month - firstPaymentMonth) % intervalMonths === 0);
    let extraPrincipal = isQuarterly ? amount : 0;

    // Cap total principal at remaining balance
    const totalPrincipal = principal + extraPrincipal;
    let adjustedPrincipal = principal;
    let adjustedExtra = extraPrincipal;

    if (totalPrincipal >= balance) {
      // Final payment — distribute proportionally or just cap
      if (principal >= balance) {
        adjustedPrincipal = balance;
        adjustedExtra = 0;
      } else {
        adjustedPrincipal = principal;
        adjustedExtra = balance - principal;
      }
    }

    const totalPrincipalPaid = adjustedPrincipal + adjustedExtra;
    const totalPayment = interest + adjustedPrincipal + adjustedExtra + inputs.escrow;
    const newBalance = balance - totalPrincipalPaid;

    rows.push({
      month,
      annualRate: rate * 12,
      standardPayment,
      interest,
      principal: adjustedPrincipal,
      extraPrincipal: adjustedExtra,
      escrow: inputs.escrow,
      totalPrincipalPaid,
      totalPayment,
      borrowerPayment: totalPayment,
      buydownSubsidy: 0,
      headroom: totalPayment - standardPayment,
      remainingBalance: newBalance,
      isQuarterlyPaymentMonth: isQuarterly,
    });

    balance = newBalance;
    month++;
  }

  return rows;
}

/**
 * Fixed-rate refinance simulation.
 * Ports: simulate_mortgage() + generate_refi_schedule.py
 *
 * Key: startBalance = currentBalance + closingCosts
 * If useMinimumPayment, payment = calculateFixedPI(startBalance, rate, term) + escrow
 */
export function simulateRefi(inputs: LoanInputs): AmortizationRow[] {
  const { refi, escrow, currentBalance, currentMonth, balanceIsManualOverride, originalPrincipal, armRates, standardPayments: std } = inputs;
  const resolvedStd = resolveStandardPayments(inputs);

  const effectiveCurrentBalance = balanceIsManualOverride
    ? currentBalance
    : calculateBalanceAtMonth(originalPrincipal, currentMonth, armRates, resolvedStd);

  const startBalance = effectiveCurrentBalance + refi.closingCosts;
  const monthlyRate = refi.annualRate / 12;
  const minPI = calculateFixedPI(startBalance, refi.annualRate, refi.termYears);
  const minPayment = minPI + escrow;
  const targetPayment = refi.useMinimumPayment ? minPayment : refi.targetMonthlyPayment;

  const rows: AmortizationRow[] = [];
  let balance = startBalance;
  let month = currentMonth; // track absolute loan month for display
  const MAX_MONTHS = 480;

  while (balance > 0.005 && rows.length < MAX_MONTHS) {
    const interest = balance * monthlyRate;
    const standardPayment = minPI + escrow;

    let principal = targetPayment - escrow - interest;
    if (principal >= balance) principal = balance;
    if (principal < 0) principal = 0;

    const totalPayment = interest + principal + escrow;
    const newBalance = balance - principal;

    rows.push({
      month,
      annualRate: refi.annualRate,
      standardPayment,
      interest,
      principal,
      extraPrincipal: refi.useMinimumPayment ? 0 : Math.max(0, targetPayment - minPayment),
      escrow,
      totalPrincipalPaid: principal,
      totalPayment,
      borrowerPayment: totalPayment,
      buydownSubsidy: 0,
      headroom: totalPayment - standardPayment,
      remainingBalance: newBalance,
      isQuarterlyPaymentMonth: false,
    });

    balance = newBalance;
    month++;
  }

  return rows;
}

/**
 * 2-1 Buydown simulation.
 *
 * Key distinction from ARM:
 * - Interest ALWAYS accrues at noteRate (the full fixed rate)
 * - In buydown period (years 1-2), borrower pays at reduced buydownRate
 * - The difference (subsidyAmount) is covered by the lender/seller
 * - principal paid = fullPI - interest (same as plain fixed-rate loan)
 * - After buydown period: borrower pays full fixed rate, no more subsidy
 *
 * This means the balance tracks higher than ARM (where interest accrues at reduced rate).
 */
export function simulateBuydown(inputs: LoanInputs): AmortizationRow[] {
  const { buydown, escrow, currentMonth, currentBalance, balanceIsManualOverride,
    originalPrincipal, armRates, standardPayments } = inputs;
  const resolvedStd = resolveStandardPayments(inputs);

  const effectiveBalance = balanceIsManualOverride
    ? currentBalance
    : calculateBalanceAtMonth(originalPrincipal, currentMonth, armRates, resolvedStd);

  // Resolve buydown rates
  const year1Rate = buydown.useAutoRates ? buydown.noteRate - 0.02 : buydown.year1Rate;
  const year2Rate = buydown.useAutoRates ? buydown.noteRate - 0.01 : buydown.year2Rate;

  // Buydown period durations
  const year1Duration = buydown.useSamePeriodsAsARM ? armRates.year1DurationMonths : 12;
  const year2Duration = buydown.useSamePeriodsAsARM ? armRates.year2DurationMonths : 12;

  const noteMonthlyRate = buydown.noteRate / 12;
  const fullPI = calculateFixedPI(effectiveBalance, buydown.noteRate, buydown.termYears);

  function getBuydownRate(absoluteMonth: number): number | null {
    const monthsIntoLoan = absoluteMonth; // month 1 = first month of loan
    if (monthsIntoLoan <= year1Duration) return year1Rate / 12;
    if (monthsIntoLoan <= year1Duration + year2Duration) return year2Rate / 12;
    return null; // no buydown — pay full rate
  }

  function getMinPI(balance: number, absoluteMonth: number): number {
    const buydownRate = getBuydownRate(absoluteMonth);
    if (buydownRate !== null) {
      // Borrower pays PI based on buydown rate on ORIGINAL balance (set at origination)
      // We use current balance for simplicity (conservative approximation)
      return calculateFixedPI(balance, (buydownRate * 12), buydown.termYears -
        Math.floor((absoluteMonth - currentMonth) / 12));
    }
    return calculateFixedPI(balance, buydown.noteRate, buydown.termYears -
      Math.floor((absoluteMonth - currentMonth) / 12));
  }

  const rows: AmortizationRow[] = [];
  let balance = effectiveBalance;
  let month = currentMonth;
  const MAX_MONTHS = 480;

  while (balance > 0.005 && rows.length < MAX_MONTHS) {
    // Interest always at note rate
    const interest = balance * noteMonthlyRate;

    // Full PI (what lender is owed based on current balance)
    const currentFullPI = calculateFixedPI(balance, buydown.noteRate, buydown.termYears);
    const standardPayment = currentFullPI + escrow;

    // Borrower's payment
    const buydownRate = getBuydownRate(month);
    const inBuydownPeriod = buydownRate !== null;
    let borrowerPI: number;

    if (inBuydownPeriod) {
      borrowerPI = calculateFixedPI(balance, buydownRate! * 12, buydown.termYears);
    } else {
      borrowerPI = currentFullPI;
    }

    // Principal paid = what lender receives - interest (same as fixed rate)
    let principal = currentFullPI - interest;

    if (principal >= balance) {
      principal = balance;
      borrowerPI = balance + interest - (inBuydownPeriod ? (currentFullPI - borrowerPI) : 0);
    }
    if (principal < 0) principal = 0;

    const subsidyAmount = inBuydownPeriod ? Math.max(0, currentFullPI - borrowerPI) : 0;
    const borrowerPayment = borrowerPI + escrow;
    const totalPayment = borrowerPayment; // borrower's out-of-pocket
    const newBalance = balance - principal;

    rows.push({
      month,
      annualRate: buydown.noteRate,
      standardPayment,
      interest,
      principal,
      extraPrincipal: 0,
      escrow,
      totalPrincipalPaid: principal,
      totalPayment,
      borrowerPayment,
      buydownSubsidy: subsidyAmount,
      headroom: borrowerPayment - standardPayment, // typically negative in buydown period
      remainingBalance: newBalance,
      isQuarterlyPaymentMonth: false,
    });

    balance = newBalance;
    month++;
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

function buildPayoffDate(currentMonth: number, monthsToPayoff: number, inputs: LoanInputs): Date {
  // loanStartMonth is 1-based calendar month (1=Jan, 5=May)
  // currentMonth is months elapsed since origination
  // payoff is currentMonth + monthsToPayoff months after origination
  const absoluteMonths = inputs.loanStartMonth - 1 + currentMonth + monthsToPayoff;
  const year = inputs.loanStartYear + Math.floor(absoluteMonths / 12);
  const month = absoluteMonths % 12;
  return new Date(year, month, 1);
}

function buildInvestmentProjection(
  schedule: AmortizationRow[],
  scenarioType: ScenarioType,
  inputs: LoanInputs,
  armBaselineMonths: number
): InvestmentProjection {
  const monthsToPayoff = schedule.length;
  const totalMonths = armBaselineMonths; // 30-yr ARM baseline

  // Scenario A: pay off, then invest freed cash flows
  const lastRow = schedule[schedule.length - 1];
  const monthlyAfterPayoff = inputs.targetMonthlyPayment; // simplified
  const scenarioA_months = Math.max(0, totalMonths - monthsToPayoff);
  const scenarioA_value = projectInvestment(monthlyAfterPayoff, scenarioA_months, inputs.annualInvestmentReturn);

  // Scenario B: invest the overpayment each month throughout
  const avgOverpayment = schedule.reduce((sum, r) => sum + r.extraPrincipal + r.buydownSubsidy, 0) / monthsToPayoff;
  const scenarioB_value = projectInvestment(avgOverpayment, totalMonths, inputs.annualInvestmentReturn);

  return {
    scenarioA_investmentValue: scenarioA_value,
    scenarioA_monthsInvesting: scenarioA_months,
    scenarioA_monthlyContribution: monthlyAfterPayoff,
    scenarioB_investmentValue: scenarioB_value,
    scenarioB_monthsInvesting: totalMonths,
    scenarioB_monthlyContribution: avgOverpayment,
    netBenefitA_vs_B: scenarioA_value - scenarioB_value,
    annualReturnUsed: inputs.annualInvestmentReturn,
  };
}

export function aggregateScenario(
  schedule: AmortizationRow[],
  scenarioType: ScenarioType,
  label: string,
  inputs: LoanInputs,
  armBaselineInterest: number,
  armBaselineMonths: number
): ScenarioResult {
  const totalInterest = schedule.reduce((sum, r) => sum + r.interest, 0);
  const totalPayments = schedule.reduce((sum, r) => sum + r.borrowerPayment, 0);
  const totalExtraPrincipal = schedule.reduce((sum, r) => sum + r.extraPrincipal, 0);
  const totalBuydownSubsidy = schedule.reduce((sum, r) => sum + r.buydownSubsidy, 0);
  const avgMonthlyHeadroom = schedule.reduce((sum, r) => sum + r.headroom, 0) / schedule.length;

  return {
    scenarioType,
    label,
    schedule,
    totalInterest,
    totalPayments,
    totalExtraPrincipal,
    totalBuydownSubsidy,
    monthsToPayoff: schedule.length,
    payoffDate: buildPayoffDate(inputs.currentMonth, schedule.length, inputs),
    interestSavedVsARM: armBaselineInterest - totalInterest,
    monthsSavedVsARM: armBaselineMonths - schedule.length,
    avgMonthlyHeadroom,
    investmentProjection: buildInvestmentProjection(schedule, scenarioType, inputs, armBaselineMonths),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL RUNNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs all scenarios and returns a ComparisonMatrix.
 * This is what App.tsx calls via useMemo.
 */
export function runAllScenarios(inputs: LoanInputs): ComparisonMatrix {
  // ARM baseline: 30-yr minimum payment only (no overpayment)
  const armBaselineInputs: LoanInputs = {
    ...inputs,
    targetMonthlyPayment: (() => {
      const std = resolveStandardPayments(inputs);
      return getStandardPI(inputs.currentMonth, std, inputs.armRates) + inputs.escrow;
    })(),
    quarterly: { ...inputs.quarterly, enabled: false },
  };
  const armBaselineSchedule = simulateARM(armBaselineInputs);
  const armBaselineInterest = armBaselineSchedule.reduce((s, r) => s + r.interest, 0);
  const armBaselineMonths = armBaselineSchedule.length;

  const aggregate = (schedule: AmortizationRow[], type: ScenarioType, label: string) =>
    aggregateScenario(schedule, type, label, inputs, armBaselineInterest, armBaselineMonths);

  // Core scenarios
  const armSchedule = simulateARM(inputs);
  const armQuarterlySchedule = simulateARMWithQuarterly(inputs);
  const refiSchedule = simulateRefi(inputs);

  // 15yr minimum: refi with minimum payment
  const refi15Inputs: LoanInputs = {
    ...inputs,
    refi: { ...inputs.refi, termYears: 15, useMinimumPayment: true },
  };
  const refi15Schedule = simulateRefi(refi15Inputs);

  const scenarios: ScenarioResult[] = [
    aggregate(armSchedule, 'ARM_FIXED_PAYMENT', `ARM $${(inputs.targetMonthlyPayment / 1000).toFixed(0)}k/mo`),
    aggregate(armQuarterlySchedule, 'ARM_QUARTERLY_EXTRA', `ARM + $${(inputs.quarterly.amount / 1000).toFixed(0)}k Qtrly`),
    aggregate(refiSchedule, 'REFI_30YR_FIXED', `Refi ${(inputs.refi.annualRate * 100).toFixed(2)}% 30yr $${(inputs.refi.targetMonthlyPayment / 1000).toFixed(0)}k`),
    aggregate(refi15Schedule, 'REFI_15YR_MIN', `Refi ${(inputs.refi.annualRate * 100).toFixed(2)}% 15yr Min`),
  ];

  // Optional buydown scenarios
  if (inputs.buydown.enabled) {
    const buydownSchedule = simulateBuydown(inputs);
    scenarios.push(aggregate(buydownSchedule, 'BUYDOWN_2_1', `2-1 Buydown (${(inputs.buydown.noteRate * 100).toFixed(3)}% note)`));

    // Fixed rate normal baseline (same as simulateRefi with no closing costs, minimum payment at note rate)
    const fixedNormalInputs: LoanInputs = {
      ...inputs,
      refi: {
        ...inputs.refi,
        annualRate: inputs.buydown.noteRate,
        closingCosts: 0,
        termYears: inputs.buydown.termYears,
        useMinimumPayment: true,
      },
    };
    const fixedNormalSchedule = simulateRefi(fixedNormalInputs);
    scenarios.push(aggregate(fixedNormalSchedule, 'FIXED_RATE_NORMAL', `Fixed ${(inputs.buydown.noteRate * 100).toFixed(3)}% (no subsidy)`));
  }

  return { scenarios, armBaselineInterest, armBaselineMonths };
}
