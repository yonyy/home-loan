# HomeLoan Dashboard

A local-first mortgage strategy analysis tool. Compare ARM continuation, refinance scenarios, and custom payment strategies side-by-side with interactive charts — replacing the previous workflow of manually editing Python scripts.

## What it does

You create named **Comparison Pages** (e.g. "Aggressive Paydown", "Rate Sensitivity", "Post-Refi Analysis") and populate each one with up to 6 **strategies**. Every page persists to `localStorage` and survives browser refreshes.

Each strategy configures:

- **Loan type** — ARM, Fixed (new loan), or Refi (fixed, adds closing costs to balance)
- **Balance & escrow** — current remaining balance and monthly escrow amount
- **Target payment** — what you plan to pay per month (leave blank to simulate minimum payment)
- **Rates** — ARM year-1/2/3+ rates, or fixed rate + term

The dashboard then shows for each strategy:

- Payoff timeline and total interest cost
- Minimum required payment and headroom (surplus above minimum, green = positive)
- Remaining balance curves overlaid on one chart (ARM rate step-ups marked at months 12 and 24)
- Cumulative interest curves on a second chart
- Per-strategy P&I breakdown area charts
- Comparison table with savings vs. worst-case strategy

## Getting started

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

**Edit strategies** — click "⚙ Edit strategies" to slide open the sidebar. Add, remove, or update any loan parameter. Charts update in real time.

**Done editing** — click "✓ Done editing" to collapse the sidebar for a clean reading/presentation view.

**New comparison page** — click `+` in the top tab bar to create a new page with a fresh set of strategies. Name it inline by clicking the page title.

**Delete a page** — click the `×` next to a tab (only available when 2+ pages exist).

All pages are saved automatically to `localStorage` under the key `homeloan_pages_v2`.

## Mortgage engine

`buildAmortization(strategy)` in `src/App.tsx` simulates month-by-month amortization:

- **ARM** — interest accrues at year-1 rate for months 1–12, year-2 for months 13–24, year-3+ thereafter. Principal = `targetPayment − escrow − interest`.
- **Fixed / Refi** — constant rate throughout. Starting balance for Refi includes closing costs. When `targetPayment` is blank, the minimum P+I is calculated via the standard amortization formula and used as the effective payment.
- **Minimum P+I formula** — `P × r(1+r)ⁿ / ((1+r)ⁿ − 1)` where `r = annualRate/12` and `n = termYears × 12`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript (Vite) |
| Charts | Recharts 3 |
| State | React `useState` / `useCallback` / `useMemo` |
| Persistence | `localStorage` |
| Styling | Inline styles (self-contained, no CSS files required) |

## Project layout

```
app/
├── src/
│   ├── App.tsx          # Entire app: engine, components, state
│   ├── main.tsx         # React root mount
│   └── index.css        # Empty — all styles are inline
├── vite.config.ts       # resolve.dedupe: ['react','react-dom'] (prevents duplicate React from recharts deps)
└── package.json
```

The `src/components/`, `src/logic/`, `src/hooks/`, `src/styles/`, and `src/types/` directories contain the previous single-scenario dashboard implementation and are no longer imported by `App.tsx`. They can be deleted or repurposed.

## Default loan values

The default strategies are pre-filled with the following loan parameters (edit freely in the UI):

| Parameter | Value |
|-----------|-------|
| Current balance | $567,992.60 |
| Escrow | $856.43 / mo |
| ARM rates | 4.375% → 5.375% → 6.375% |
| Target payment | $5,000 / mo |
| Refi rate | 5.30% |
| Refi closing costs | $5,000 |
