import { useMemo } from 'react';
import type { LoanInputs, ComparisonMatrix } from '../types/loan.types';
import { runAllScenarios } from '../logic/MortgageEngine';

export function useMortgageEngine(inputs: LoanInputs): ComparisonMatrix {
  return useMemo(() => runAllScenarios(inputs), [
    inputs.originalPrincipal,
    inputs.loanStartMonth,
    inputs.loanStartYear,
    inputs.originalTermYears,
    inputs.currentMonth,
    inputs.currentBalance,
    inputs.balanceIsManualOverride,
    inputs.escrow,
    inputs.armRates.year1Rate,
    inputs.armRates.year2Rate,
    inputs.armRates.year3PlusRate,
    inputs.armRates.year1DurationMonths,
    inputs.armRates.year2DurationMonths,
    inputs.standardPayments.year1,
    inputs.standardPayments.year2,
    inputs.standardPayments.year3Plus,
    inputs.standardPayments.useAutoCalculate,
    inputs.targetMonthlyPayment,
    inputs.quarterly.enabled,
    inputs.quarterly.amount,
    inputs.quarterly.intervalMonths,
    inputs.quarterly.firstPaymentMonth,
    inputs.refi.annualRate,
    inputs.refi.termYears,
    inputs.refi.closingCosts,
    inputs.refi.targetMonthlyPayment,
    inputs.refi.useMinimumPayment,
    inputs.buydown.enabled,
    inputs.buydown.noteRate,
    inputs.buydown.year1Rate,
    inputs.buydown.year2Rate,
    inputs.buydown.useAutoRates,
    inputs.buydown.termYears,
    inputs.buydown.useSamePeriodsAsARM,
    inputs.annualInvestmentReturn,
  ]);
}
