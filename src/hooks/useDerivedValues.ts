import { useMemo } from 'react';
import type { LoanInputs } from '../types/loan.types';
import {
  calculateBalanceAtMonth,
  calculateFixedPI,
  getARMMonthlyRate,
  resolveStandardPayments,
} from '../logic/MortgageEngine';

export interface DerivedValues {
  autoBalance: number;
  effectiveBalance: number;
  autoStandardPayments: { year1: number; year2: number; year3Plus: number };
  currentARMYear: 1 | 2 | 3;
  currentARMRate: number;
}

export function useDerivedValues(inputs: LoanInputs): DerivedValues {
  return useMemo(() => {
    const autoStd = {
      year1: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year1Rate, inputs.originalTermYears),
      year2: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year2Rate, inputs.originalTermYears),
      year3Plus: calculateFixedPI(inputs.originalPrincipal, inputs.armRates.year3PlusRate, inputs.originalTermYears),
    };
    const resolvedStd = resolveStandardPayments(inputs);
    const autoBalance = calculateBalanceAtMonth(
      inputs.originalPrincipal,
      inputs.currentMonth,
      inputs.armRates,
      resolvedStd
    );
    const effectiveBalance = inputs.balanceIsManualOverride ? inputs.currentBalance : autoBalance;
    const currentARMRate = getARMMonthlyRate(inputs.currentMonth, inputs.armRates) * 12;

    let currentARMYear: 1 | 2 | 3 = 1;
    if (inputs.currentMonth > inputs.armRates.year1DurationMonths + inputs.armRates.year2DurationMonths) {
      currentARMYear = 3;
    } else if (inputs.currentMonth > inputs.armRates.year1DurationMonths) {
      currentARMYear = 2;
    }

    return { autoBalance, effectiveBalance, autoStandardPayments: autoStd, currentARMYear, currentARMRate };
  }, [
    inputs.originalPrincipal,
    inputs.currentMonth,
    inputs.armRates,
    inputs.originalTermYears,
    inputs.currentBalance,
    inputs.balanceIsManualOverride,
    inputs.standardPayments,
  ]);
}
