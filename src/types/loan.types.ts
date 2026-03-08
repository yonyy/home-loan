// ── ARM Rate Structure ────────────────────────────────────────────────────────
export interface ARMRateSchedule {
  year1Rate: number;               // default 0.04375
  year2Rate: number;               // default 0.05375
  year3PlusRate: number;           // default 0.06375
  year1DurationMonths: number;     // default 12
  year2DurationMonths: number;     // default 12
}

// ── Standard P+I Payments ─────────────────────────────────────────────────────
export interface StandardPayments {
  year1: number;                   // default 4037.48
  year2: number;                   // default 4424.12
  year3Plus: number;               // default 4831.23
  useAutoCalculate: boolean;
}

// ── Quarterly Extra Payment ───────────────────────────────────────────────────
export interface QuarterlyPaymentConfig {
  enabled: boolean;
  amount: number;                  // default 13000
  intervalMonths: number;          // default 4
  firstPaymentMonth: number;       // default 10
}

// ── Refinance Parameters ──────────────────────────────────────────────────────
export interface RefiConfig {
  annualRate: number;              // default 0.053
  termYears: number;               // default 30
  closingCosts: number;            // default 5000
  targetMonthlyPayment: number;    // default 5000
  useMinimumPayment: boolean;
}

// ── 2-1 Buydown Parameters ────────────────────────────────────────────────────
// A 2-1 buydown is a FIXED-rate loan. Interest always accrues at noteRate.
// The lender (or seller/builder) subsidizes the borrower's payment in years 1-2.
// From the borrower's perspective there is no escrow account or upfront cost —
// the subsidy is provided by the lender as a credit.
export interface BuydownConfig {
  enabled: boolean;
  noteRate: number;                // full fixed rate (e.g., 0.06375); interest accrues here
  year1Rate: number;               // borrower's effective rate year 1 (e.g., 0.04375)
  year2Rate: number;               // borrower's effective rate year 2 (e.g., 0.05375)
  useAutoRates: boolean;           // true = year1 = noteRate-0.02, year2 = noteRate-0.01
  termYears: number;               // default 30
  subsidySource: 'lender' | 'seller' | 'builder' | 'other';
  useSamePeriodsAsARM: boolean;    // true = use armRates year1/2 durations; false = 12/12
}

// ── Master Input Object ───────────────────────────────────────────────────────
export interface LoanInputs {
  // Loan Identity
  originalPrincipal: number;       // default 580000
  loanStartMonth: number;          // 1-12 (calendar month number, 1 = Jan)
  loanStartYear: number;           // e.g. 2025
  originalTermYears: number;       // default 30
  currentMonth: number;            // months elapsed since origination (default 10)
  currentBalance: number;          // default 567992.60
  balanceIsManualOverride: boolean;
  escrow: number;                  // default 856.43

  // ARM Rate Structure
  armRates: ARMRateSchedule;

  // Standard Payments
  standardPayments: StandardPayments;

  // Payment Strategy (ARM scenarios)
  targetMonthlyPayment: number;    // default 5000

  // Quarterly Extra Principal
  quarterly: QuarterlyPaymentConfig;

  // Refinance
  refi: RefiConfig;

  // 2-1 Buydown
  buydown: BuydownConfig;

  // Investment Projection
  annualInvestmentReturn: number;  // default 0.15
}

// ── Scenario Types ────────────────────────────────────────────────────────────
export type ScenarioType =
  | 'ARM_FIXED_PAYMENT'
  | 'ARM_QUARTERLY_EXTRA'
  | 'REFI_30YR_FIXED'
  | 'REFI_15YR_MIN'
  | 'BUYDOWN_2_1'
  | 'FIXED_RATE_NORMAL';

// ── Per-Month Amortization Row ────────────────────────────────────────────────
export interface AmortizationRow {
  month: number;                   // absolute month number (e.g. 10, 11, ...)
  annualRate: number;              // effective annual rate this month
  standardPayment: number;         // minimum required payment (P+I+E for period)
  interest: number;
  principal: number;               // principal paid toward balance
  extraPrincipal: number;          // overpayment / quarterly extra (0 for refi/buydown)
  escrow: number;
  totalPrincipalPaid: number;      // principal + extraPrincipal
  totalPayment: number;            // total cash out of pocket (borrowerPayment for buydown)
  borrowerPayment: number;         // same as totalPayment except during buydown period
  buydownSubsidy: number;          // lender's monthly subsidy (0 for all non-buydown rows)
  headroom: number;                // totalPayment - standardPayment (can be negative)
  remainingBalance: number;
  isQuarterlyPaymentMonth: boolean;
}

// ── Investment Projection ─────────────────────────────────────────────────────
export interface InvestmentProjection {
  // Scenario A: pay off early, then invest freed-up payments
  scenarioA_investmentValue: number;
  scenarioA_monthsInvesting: number;
  scenarioA_monthlyContribution: number;
  // Scenario B: invest overpayments throughout loan life
  scenarioB_investmentValue: number;
  scenarioB_monthsInvesting: number;
  scenarioB_monthlyContribution: number;
  netBenefitA_vs_B: number;
  annualReturnUsed: number;
}

// ── Scenario Result ───────────────────────────────────────────────────────────
export interface ScenarioResult {
  scenarioType: ScenarioType;
  label: string;
  schedule: AmortizationRow[];
  // Aggregates
  totalInterest: number;
  totalPayments: number;
  totalExtraPrincipal: number;
  totalBuydownSubsidy: number;
  monthsToPayoff: number;
  payoffDate: Date;
  // vs ARM baseline comparison
  interestSavedVsARM: number;
  monthsSavedVsARM: number;
  // Headroom
  avgMonthlyHeadroom: number;
  // Investment
  investmentProjection: InvestmentProjection | null;
}

// ── Comparison Matrix ─────────────────────────────────────────────────────────
export interface ComparisonMatrix {
  scenarios: ScenarioResult[];
  armBaselineMonths: number;    // 30-yr ARM minimum-only, used for savings calc
  armBaselineInterest: number;
}

// ── Default Inputs ────────────────────────────────────────────────────────────
export const DEFAULT_INPUTS: LoanInputs = {
  originalPrincipal: 580000,
  loanStartMonth: 5,             // May 2025
  loanStartYear: 2025,
  originalTermYears: 30,
  currentMonth: 10,
  currentBalance: 567992.60,
  balanceIsManualOverride: true,
  escrow: 856.43,

  armRates: {
    year1Rate: 0.04375,
    year2Rate: 0.05375,
    year3PlusRate: 0.06375,
    year1DurationMonths: 12,
    year2DurationMonths: 12,
  },

  standardPayments: {
    year1: 4037.48,
    year2: 4424.12,
    year3Plus: 4831.23,
    useAutoCalculate: false,
  },

  targetMonthlyPayment: 5000,

  quarterly: {
    enabled: true,
    amount: 13000,
    intervalMonths: 4,
    firstPaymentMonth: 10,
  },

  refi: {
    annualRate: 0.053,
    termYears: 30,
    closingCosts: 5000,
    targetMonthlyPayment: 5000,
    useMinimumPayment: false,
  },

  buydown: {
    enabled: false,
    noteRate: 0.06375,
    year1Rate: 0.04375,
    year2Rate: 0.05375,
    useAutoRates: true,
    termYears: 30,
    subsidySource: 'lender',
    useSamePeriodsAsARM: true,
  },

  annualInvestmentReturn: 0.15,
};
