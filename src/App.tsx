// @ts-nocheck
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Label } from "recharts";
import { ARMCliffBanner } from "./components/ARMCliffBanner";
import { computeWinners, generateTradeoff } from "./logic/tradeoffUtils";
import { projectInvestment } from "./logic/MortgageEngine";

// ─── MORTGAGE ENGINE ────────────────────────────────────────────────────────

function calcFixedPI(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function buildAmortization(strategy) {
  const {
    balance, escrow, targetPayment, loanType, armRates, fixedRate, fixedTerm, closingCosts,
    currentLoanMonth = 0,
    armYear1Months = 12,
    armYear2Months = 12,
    windfalls = [],
    standardPayments,  // optional [yr1Total, yr2Total, yr3+Total] including escrow
  } = strategy;
  const startBalance = loanType === "refi" ? balance + (closingCosts || 0) : balance;

  // For fixed/refi: single minPI computed from startBalance
  // For ARM: we'll compute per-period below; use year1 rate here only for effectivePayment fallback
  const minPI = loanType === "arm"
    ? calcFixedPI(startBalance, armRates?.[0] || 0.04375, 30)
    : calcFixedPI(startBalance, fixedRate, fixedTerm);
  const effectivePayment = targetPayment != null ? targetPayment : minPI + escrow;

  const rows = [];
  let remaining = startBalance;
  let month = 1;
  let totalInterest = 0;

  // ARM boundary months are relative to the simulation start (month 1).
  // currentLoanMonth tells us how far into the ARM period we already are,
  // so the boundaries shift accordingly.
  const simYear1End = Math.max(0, armYear1Months - currentLoanMonth);
  const simYear2End = simYear1End + armYear2Months;

  // Pre-compute per-period standard payments (min payment the borrower owes each period).
  // For ARM: use caller-supplied standardPayments if provided (locked in at origination),
  // otherwise compute from startBalance + period rate.
  function getStdPayment(simMonth) {
    if (loanType !== "arm") return calcFixedPI(startBalance, fixedRate, fixedTerm) + escrow;
    if (standardPayments) {
      if (simMonth <= simYear1End) return standardPayments[0];
      if (simMonth <= simYear2End) return standardPayments[1];
      return standardPayments[2];
    }
    if (simMonth <= simYear1End) return calcFixedPI(startBalance, armRates[0], 30) + escrow;
    if (simMonth <= simYear2End) return calcFixedPI(startBalance, armRates[1], 30) + escrow;
    return calcFixedPI(startBalance, armRates[2], 30) + escrow;
  }

  while (remaining > 0.01 && month <= 480) {
    let rate;
    if (loanType === "arm") {
      if (month <= simYear1End) rate = armRates[0] / 12;
      else if (month <= simYear2End) rate = armRates[1] / 12;
      else rate = armRates[2] / 12;
    } else {
      rate = fixedRate / 12;
    }

    const interest = remaining * rate;
    totalInterest += interest;
    const available = effectivePayment - escrow - interest;
    let principal = Math.max(0, Math.min(available, remaining));

    // Apply any lump-sum windfall for this month
    const windfall = windfalls.find(w => w.month === month);
    const windfallAmt = windfall ? Math.min(Math.max(0, windfall.amount || 0), remaining - principal) : 0;

    remaining = Math.max(0, remaining - principal - windfallAmt);

    rows.push({
      month,
      balance: remaining,
      interest,
      principal: principal + windfallAmt,
      totalInterest,
      payment: principal + windfallAmt + interest + escrow,
      windfallAmt,
      payment: principal + interest + escrow,
      standardPayment: getStdPayment(month),
    });

    if (remaining < 0.01) break;
    month++;
  }

  // minPayment = current period's standard payment (for summary cards / headroom gauge)
  const minPayment = getStdPayment(1);

  // ARM countdown: months from now until each rate step-up.
  // simYear1End is already 0 if we're already past year-1.
  const armCountdown = loanType === "arm" ? {
    monthsToYear2: simYear1End,
    monthsToYear3: simYear2End,
    year1Rate: armRates[0],
    year2Rate: armRates[1],
    year3Rate: armRates[2],
  } : null;

  return {
    rows,
    monthsToPayoff: rows.length,
    yearsToPayoff: rows.length / 12,
    totalInterest,
    minPayment,
    headroom: targetPayment != null && targetPayment > minPayment
      ? targetPayment - minPayment
      : 0,
    armCountdown,
  };
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const DEFAULT_STRATEGIES = [
  {
    id: "arm-5k",
    name: "2-1 Buydown — Stay & Pay $5k",
    color: "#f97316",
    loanType: "arm",
    balance: 567992.60,
    escrow: 856.43,
    targetPayment: 5000,
    armRates: [0.04375, 0.05375, 0.06375],
    fixedRate: 0.053,
    fixedTerm: 30,
    closingCosts: 0,
    currentLoanMonth: 10,
    armYear1Months: 12,
    armYear2Months: 12,
    windfalls: [],
    // Standard payments locked in at origination (total including escrow, from real loan statements)
    standardPayments: [4037.48, 4424.12, 4831.23],
  },
  {
    id: "refi-30-5k",
    name: "Refi 30-yr @ 5.3% — $5k/mo",
    color: "#22c55e",
    loanType: "refi",
    balance: 567992.60,
    escrow: 856.43,
    targetPayment: 5000,
    armRates: [0.04375, 0.05375, 0.06375],
    fixedRate: 0.053,
    fixedTerm: 30,
    closingCosts: 5000,
    windfalls: [],
  },
  {
    id: "refi-15-min",
    name: "Refi 15-yr @ 5.3% — Minimum",
    color: "#3b82f6",
    loanType: "refi",
    balance: 567992.60,
    escrow: 856.43,
    targetPayment: null,
    armRates: [0.04375, 0.05375, 0.06375],
    fixedRate: 0.053,
    fixedTerm: 15,
    closingCosts: 5000,
    windfalls: [],
  },
];

const PALETTE = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

const STORAGE_KEY = "homeloan_pages_v2";

function loadPages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function savePages(pages) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
  } catch {}
}

// ─── FORMATTERS ─────────────────────────────────────────────────────────────

const fmt$ = (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtK = (v) => v == null ? "—" : "$" + (v / 1000).toFixed(0) + "k";
const fmtYr = (v) => v == null ? "—" : v.toFixed(1) + " yrs";

// ─── CSV EXPORT ──────────────────────────────────────────────────────────────

function exportCSV(amort, strategy) {
  const startBalance = amort.rows.length > 0 ? amort.rows[0].balance + amort.rows[0].principal : 1;
  const headers = [
    "Month", "Year", "Standard Payment", "Interest", "Escrow",
    "Principal", "Overpayment", "Total Principal", "Total Payment",
    "Cumul. Interest", "Remaining Balance", "% Paid Off",
  ];
  const lines = [headers.join(",")];
  let cumPrincipal = 0;
  amort.rows.forEach(r => {
    cumPrincipal += r.principal;
    const rowStdPayment = r.standardPayment ?? amort.minPayment;
    const overpayment = Math.max(0, r.payment - rowStdPayment);
    const paidOffPct = ((startBalance - r.balance) / startBalance * 100).toFixed(1) + "%";
    lines.push([
      r.month,
      Math.ceil(r.month / 12),
      rowStdPayment.toFixed(2),
      r.interest.toFixed(2),
      strategy.escrow.toFixed(2),
      r.principal.toFixed(2),
      overpayment.toFixed(2),
      cumPrincipal.toFixed(2),
      r.payment.toFixed(2),
      r.totalInterest.toFixed(2),
      r.balance.toFixed(2),
      paidOffPct,
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${strategy.name.replace(/[^a-z0-9]+/gi, "_")}_schedule.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── COMPONENTS ─────────────────────────────────────────────────────────────

function StrategyForm({ strategy, onChange, onDelete }) {
  const [windfallsOpen, setWindfallsOpen] = useState(false);
  const upd = (field, val) => onChange({ ...strategy, [field]: val });
  const updNum = (field, val) => onChange({ ...strategy, [field]: val === "" ? "" : parseFloat(val) || 0 });

  const windfalls = strategy.windfalls || [];
  const addWindfall = () => onChange({ ...strategy, windfalls: [...windfalls, { month: 12, amount: 10000 }] });
  const removeWindfall = (i) => onChange({ ...strategy, windfalls: windfalls.filter((_, idx) => idx !== i) });
  const updWindfall = (i, field, val) => {
    const updated = windfalls.map((w, idx) => idx === i ? { ...w, [field]: parseFloat(val) || 0 } : w);
    onChange({ ...strategy, windfalls: updated });
  };

  return (
    <div style={{
      background: "rgba(255,255,255,0.035)",
      border: `1px solid ${strategy.color}44`,
      borderRadius: 12,
      padding: "18px 20px",
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: strategy.color, flexShrink: 0 }} />
        <input
          value={strategy.name}
          onChange={e => upd("name", e.target.value)}
          style={inputStyle({ flex: 1, fontWeight: 600, fontSize: 13 })}
          placeholder="Strategy name"
        />
        {onDelete && (
          <button onClick={onDelete} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
        <Field label="Loan Balance ($)">
          <input type="number" value={strategy.balance} onChange={e => updNum("balance", e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Escrow ($/mo)">
          <input type="number" value={strategy.escrow} onChange={e => updNum("escrow", e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Target Payment ($/mo)">
          <input
            type="number"
            value={strategy.targetPayment ?? ""}
            onChange={e => upd("targetPayment", e.target.value === "" ? null : parseFloat(e.target.value))}
            placeholder="Leave blank = minimum"
            style={inputStyle()}
          />
        </Field>
        <Field label="Loan Type">
          <select value={strategy.loanType} onChange={e => upd("loanType", e.target.value)} style={inputStyle()}>
            <option value="arm">2-1 Buydown</option>
            <option value="fixed">Fixed (New)</option>
            <option value="refi">Refi (Fixed)</option>
          </select>
        </Field>

        {(strategy.loanType === "fixed" || strategy.loanType === "refi") && <>
          <Field label="Fixed Rate (%)">
            <input type="number" step="0.01" value={(strategy.fixedRate * 100).toFixed(3)} onChange={e => upd("fixedRate", parseFloat(e.target.value) / 100)} style={inputStyle()} />
          </Field>
          <Field label="Term (years)">
            <select value={strategy.fixedTerm} onChange={e => upd("fixedTerm", parseInt(e.target.value))} style={inputStyle()}>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={20}>20</option>
              <option value={25}>25</option>
              <option value={30}>30</option>
            </select>
          </Field>
        </>}
        {strategy.loanType === "refi" && (
          <Field label="Closing Costs ($)">
            <input type="number" value={strategy.closingCosts} onChange={e => updNum("closingCosts", e.target.value)} style={inputStyle()} />
          </Field>
        )}
        {strategy.loanType === "arm" && <>
          <Field label="Yr 1 Rate (%)">
            <input type="number" step="0.01" value={(strategy.armRates[0] * 100).toFixed(3)} onChange={e => upd("armRates", [parseFloat(e.target.value) / 100, strategy.armRates[1], strategy.armRates[2]])} style={inputStyle()} />
          </Field>
          <Field label="Yr 2 Rate (%)">
            <input type="number" step="0.01" value={(strategy.armRates[1] * 100).toFixed(3)} onChange={e => upd("armRates", [strategy.armRates[0], parseFloat(e.target.value) / 100, strategy.armRates[2]])} style={inputStyle()} />
          </Field>
          <Field label="Yr 3+ Rate (%)">
            <input type="number" step="0.01" value={(strategy.armRates[2] * 100).toFixed(3)} onChange={e => upd("armRates", [strategy.armRates[0], strategy.armRates[1], parseFloat(e.target.value) / 100])} style={inputStyle()} />
          </Field>
          <Field label="Months elapsed in ARM">
            <input type="number" min="0" max="24" value={strategy.currentLoanMonth ?? 0} onChange={e => updNum("currentLoanMonth", e.target.value)} style={inputStyle()} />
          </Field>
        </>}
      </div>

      {/* Windfalls / Lump-Sum Payments */}
      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => setWindfallsOpen(o => !o)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: 11, color: windfalls.length > 0 ? "#a855f7" : "#555",
            fontWeight: 600, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <span style={{ fontSize: 9 }}>{windfallsOpen ? "▾" : "▸"}</span>
          LUMP-SUM PAYMENTS {windfalls.length > 0 && <span style={{ color: "#a855f7" }}>({windfalls.length})</span>}
        </button>

        {windfallsOpen && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {windfalls.length === 0 && (
              <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>No lump-sum payments. Add one below.</div>
            )}
            {windfalls.map((w, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                <Field label="Month #">
                  <input
                    type="number" min="1" max="480"
                    value={w.month}
                    onChange={e => updWindfall(i, "month", e.target.value)}
                    style={inputStyle()}
                  />
                </Field>
                <Field label="Amount ($)">
                  <input
                    type="number" min="0"
                    value={w.amount}
                    onChange={e => updWindfall(i, "amount", e.target.value)}
                    style={inputStyle()}
                  />
                </Field>
                <button
                  onClick={() => removeWindfall(i)}
                  style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "6px 4px", alignSelf: "flex-end" }}
                >×</button>
              </div>
            ))}
            <button
              onClick={addWindfall}
              style={{
                marginTop: 2, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)",
                borderRadius: 6, color: "#a855f7", fontSize: 11, fontWeight: 600, padding: "5px 10px",
                cursor: "pointer", alignSelf: "flex-start", letterSpacing: "0.04em",
              }}
            >+ Add Payment</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#888", marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function inputStyle(extra = {}) {
  return {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "6px 9px",
    color: "#e8e8e8",
    fontSize: 12,
    outline: "none",
    ...extra,
  };
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1a1a1a",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      <div style={{ color: "#888", marginBottom: 6 }}>Month {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{fmt$(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

function ChartCard({ title, children, dimmed = false }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12,
      padding: "16px 18px",
      opacity: dimmed ? 0.22 : 1,
      transition: "opacity 0.2s ease",
    }}>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

// ─── SCHEDULE MODAL ──────────────────────────────────────────────────────────

function ScheduleModal({ amort, strategy, onClose }) {
  const [advanced, setAdvanced] = useState(false);
  const startBalance = amort.rows.length > 0 ? amort.rows[0].balance + amort.rows[0].principal : 1;

  // Pre-compute cumulative principal for each row
  let runningPrincipal = 0;
  const enrichedRows = amort.rows.map(r => {
    runningPrincipal += r.principal;
    return { ...r, totalPrincipal: runningPrincipal };
  });

  const simpleColCount = 5;
  const advancedColCount = 12;
  const colCount = advanced ? advancedColCount : simpleColCount;

  const tableRows = [];
  let prevYear = 0;
  enrichedRows.forEach((r, i) => {
    const yr = Math.ceil(r.month / 12);
    if (yr !== prevYear) {
      tableRows.push({ type: "year", year: yr, key: `yr-${yr}` });
      prevYear = yr;
    }
    tableRows.push({ type: "row", r, i, key: `m-${r.month}` });
  });

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 24px",
        overflowY: "auto",
      }}
    >
      <div style={{
        background: "#111215",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        width: "100%",
        maxWidth: 860,
        marginBottom: 40,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(90vh - 80px)",
        boxShadow: "0 28px 80px rgba(0,0,0,0.7)",
      }}>
        {/* Modal header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.4)",
          borderRadius: "16px 16px 0 0",
          flexShrink: 0,
          flexWrap: "wrap",
          rowGap: 8,
        }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: strategy.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8" }}>{strategy.name}</span>
          <span style={{ fontSize: 11, color: "#444" }}>— Amortization Schedule</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#777", background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: 4 }}>
            Payoff: <strong style={{ color: strategy.color }}>{fmtYr(amort.yearsToPayoff)}</strong>
          </span>
          <span style={{ fontSize: 10, color: "#777", background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: 4 }}>
            Total Interest: <strong style={{ color: "#e8e8e8" }}>{fmt$(amort.totalInterest)}</strong>
          </span>
          <button
            onClick={() => setAdvanced(v => !v)}
            style={{
              background: advanced ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${advanced ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: advanced ? "#3b82f6" : "#555",
              borderRadius: 6,
              padding: "5px 11px",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >{advanced ? "Simple View" : "Advanced View"}</button>
          <button
            onClick={() => exportCSV(amort, strategy)}
            style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "#22c55e",
              borderRadius: 6,
              padding: "5px 11px",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >↓ Export CSV</button>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, padding: "0 4px", lineHeight: 1, marginLeft: 4 }}
          >×</button>
        </div>

        {/* Table */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {(advanced
                  ? ["Mo", "Yr", "Standard Payment", "Interest", "Escrow", "Principal", "Overpayment", "Total Principal", "Total Payment", "Cumul. Interest", "Remaining Balance", "% Paid Off"]
                  : ["Month", "Standard Payment", "Interest", "Principal", "Remaining Balance"]
                ).map(h => (
                  <th key={h} style={{
                    padding: "8px 14px",
                    textAlign: "right",
                    color: "#444",
                    fontWeight: 600,
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    whiteSpace: "nowrap",
                    background: "#111215",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(item => {
                if (item.type === "year") {
                  return (
                    <tr key={item.key}>
                      <td colSpan={colCount} style={{
                        padding: "6px 14px 3px",
                        fontSize: 9,
                        color: "#333",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        borderTop: item.year > 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                        background: "rgba(255,255,255,0.01)",
                      }}>
                        Year {item.year}
                      </td>
                    </tr>
                  );
                }
                const { r, i } = item;
                const rowStdPayment = r.standardPayment ?? amort.minPayment;
                const overpayment = Math.max(0, r.payment - rowStdPayment);
                const paidOffPct = ((startBalance - r.balance) / startBalance * 100).toFixed(1) + "%";
                return (
                  <tr key={item.key} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#555", fontFamily: "monospace" }}>{r.month}</td>
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#3a3a3a", fontFamily: "monospace" }}>{Math.ceil(r.month / 12)}</td>}
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#888", fontFamily: "monospace" }}>{fmt$(rowStdPayment)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#f97316", fontFamily: "monospace" }}>{fmt$(r.interest)}</td>
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#666", fontFamily: "monospace" }}>{fmt$(strategy.escrow)}</td>}
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#22c55e", fontFamily: "monospace" }}>{fmt$(r.principal)}</td>
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: overpayment > 0 ? "#3b82f6" : "#3a3a3a", fontFamily: "monospace" }}>{overpayment > 0 ? fmt$(overpayment) : "—"}</td>}
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#bbb", fontFamily: "monospace" }}>{fmt$(r.totalPrincipal)}</td>}
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#bbb", fontFamily: "monospace" }}>{fmt$(r.payment)}</td>}
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#555", fontFamily: "monospace" }}>{fmt$(r.totalInterest)}</td>}
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#e8e8e8", fontFamily: "monospace", fontWeight: 600 }}>{fmt$(r.balance)}</td>
                    {advanced && <td style={{ padding: "5px 14px", textAlign: "right", color: "#555", fontFamily: "monospace" }}>{paidOffPct}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── LEGEND ──────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  {
    term: "Min Payment",
    color: "#3b82f6",
    icon: "▸",
    def: "The lowest monthly amount needed to fully pay off the loan on schedule. Calculated as P+I (principal + interest) using the standard amortization formula, plus escrow. Paying less than this means the loan won't amortize — your balance may never reach $0.",
  },
  {
    term: "Headroom",
    color: "#22c55e",
    icon: "▸",
    def: "How much above (or below) the minimum payment your target payment sits. Green = you're overpaying, which chips away at principal faster. Orange = you're underpaying the minimum — the loan is negatively amortizing and won't pay off on schedule.",
    note: "Formula: Target Payment − Min Payment",
  },
  {
    term: "Total Interest",
    color: "#f97316",
    icon: "▸",
    def: "The total dollars paid in interest over the entire life of the loan, from today to payoff. This is the primary cost comparison metric — lower is better. It does not include escrow (taxes + insurance).",
  },
  {
    term: "Payoff",
    color: "#a855f7",
    icon: "▸",
    def: "The number of years until the remaining loan balance reaches $0. Assumes you make exactly your target payment every month. If target payment is blank, it assumes the exact minimum P+I payment.",
  },
  {
    term: "Savings vs Worst",
    color: "#22c55e",
    icon: "▸",
    def: "How much total interest this strategy saves compared to the strategy with the highest total interest cost. Helps you quickly see the dollar value of refinancing or paying extra. The worst-performing strategy always shows '—'.",
  },
  {
    term: "Dashed Lines on Balance Chart",
    color: "#888",
    icon: "┊",
    def: "Vertical dashed lines at Month 12 and Month 24 mark the 2-1 buydown rate step-up points. Month 12: the rate steps from the Year-1 discounted rate to the Year-2 rate. Month 24: it steps again to the permanent Year-3+ rate, where it stays for the life of the loan. Only relevant for 2-1 buydown strategies — fixed/refi strategies are unaffected by these boundaries.",
  },
];

function Legend({ onClose }) {
  return (
    <div style={{
      background: "rgba(10,10,15,0.97)",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      padding: "16px 28px 20px",
      animation: "legendSlideIn 0.18s ease-out",
    }}>
      <style>{`
        @keyframes legendSlideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Dashboard Glossary
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1,
        }}>×</button>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "10px 24px",
      }}>
        {LEGEND_ITEMS.map(item => (
          <div key={item.term} style={{
            display: "flex",
            gap: 10,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.025)",
            borderRadius: 8,
            borderLeft: `2px solid ${item.color}66`,
          }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <span style={{ fontSize: 10, color: item.color, fontFamily: "monospace", fontWeight: 700 }}>{item.icon}</span>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#ccc", marginBottom: 4 }}>{item.term}</div>
              <div style={{ fontSize: 11, color: "#666", lineHeight: 1.55 }}>{item.def}</div>
              {item.note && (
                <div style={{ marginTop: 5, fontSize: 10, color: "#444", fontFamily: "monospace", background: "rgba(255,255,255,0.04)", padding: "3px 7px", borderRadius: 4, display: "inline-block" }}>
                  {item.note}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ONBOARDING CAROUSEL ─────────────────────────────────────────────────────

function MockSummaryCards() {
  const cards = [
    { name: "2-1 Buydown — Stay & Pay $5k", color: "#f97316", payoff: "22.3 yrs", interest: "$412k", minPmt: "$3,118", headroom: "$1,882", headroomColor: "#22c55e" },
    { name: "Refi 30-yr @ 5.3%",    color: "#22c55e", payoff: "18.7 yrs", interest: "$338k", minPmt: "$3,142", headroom: "$1,858", headroomColor: "#22c55e" },
    { name: "Refi 15-yr @ 5.3%",    color: "#3b82f6", payoff: "15.0 yrs", interest: "$221k", minPmt: "$4,533", headroom: "$467",   headroomColor: "#22c55e" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      {/* top nav mock */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", background:"rgba(0,0,0,0.5)", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)", marginBottom:4 }}>
        <div style={{ width:18, height:18, borderRadius:4, background:"linear-gradient(135deg,#3b82f6,#22c55e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>⌂</div>
        <span style={{ fontSize:10, fontWeight:700, color:"#e8e8e8" }}>HomeLoan</span>
        <div style={{ width:1, height:14, background:"rgba(255,255,255,0.1)", margin:"0 6px" }} />
        <span style={{ fontSize:10, color:"#3b82f6", fontWeight:600, borderBottom:"1.5px solid #3b82f6", paddingBottom:1 }}>Comparison 1</span>
        <div style={{ marginLeft:"auto", fontSize:10, color:"#3b82f6", background:"rgba(59,130,246,0.12)", border:"1px solid rgba(59,130,246,0.3)", borderRadius:4, padding:"2px 7px" }}>⚙ Edit</div>
      </div>
      {/* cards row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        {cards.map(c => (
          <div key={c.name} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${c.color}44`, borderRadius:8, padding:"10px 11px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:8 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:c.color, flexShrink:0 }} />
              <span style={{ fontSize:8, fontWeight:700, color:"#bbb", lineHeight:1.2 }}>{c.name}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
              {[["Payoff", c.payoff, c.color],["Total Interest", c.interest,"#e8e8e8"],["Min Payment", c.minPmt,"#bbb"],["Headroom", c.headroom, c.headroomColor]].map(([lbl,val,col]) => (
                <div key={lbl}>
                  <div style={{ fontSize:7, color:"#555", textTransform:"uppercase", letterSpacing:"0.06em" }}>{lbl}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:col as string, fontFamily:"monospace" }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockComparisonTable() {
  const rows = [
    { name:"2-1 Buydown — Stay & Pay $5k",  color:"#f97316", target:"$5,000", min:"$3,118", headroom:"$1,882", payoff:"22.3 yrs", interest:"$412,440", savings:"—",        savingsColor:"#666" },
    { name:"Refi 30-yr @ 5.3%",     color:"#22c55e", target:"$5,000", min:"$3,142", headroom:"$1,858", payoff:"18.7 yrs", interest:"$338,201", savings:"+$74,239", savingsColor:"#22c55e" },
    { name:"Refi 15-yr @ 5.3%",     color:"#3b82f6", target:"—",      min:"$4,533", headroom:"$467",   payoff:"15.0 yrs", interest:"$221,084", savings:"+$191,356",savingsColor:"#22c55e" },
  ];
  const cols = ["Strategy","Target Pmt","Min Pmt","Headroom","Payoff","Total Interest","Savings vs Worst"];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", background:"rgba(0,0,0,0.5)", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)", marginBottom:2 }}>
        <div style={{ width:18, height:18, borderRadius:4, background:"linear-gradient(135deg,#3b82f6,#22c55e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>⌂</div>
        <span style={{ fontSize:10, fontWeight:700, color:"#e8e8e8" }}>HomeLoan</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, overflow:"hidden" }}>
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:"6px 10px", gap:6 }}>
          {cols.map(c => <div key={c} style={{ flex:c==="Strategy"?2:1, fontSize:7, color:"#555", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>{c}</div>)}
        </div>
        {rows.map((r,i) => (
          <div key={r.name} style={{ display:"flex", alignItems:"center", padding:"7px 10px", gap:6, borderBottom: i<rows.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
            <div style={{ flex:2, display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:r.color }} />
              <span style={{ fontSize:8, fontWeight:600, color:"#ccc" }}>{r.name}</span>
            </div>
            <div style={{ flex:1, fontSize:8, color:"#bbb", fontFamily:"monospace" }}>{r.target}</div>
            <div style={{ flex:1, fontSize:8, color:"#bbb", fontFamily:"monospace" }}>{r.min}</div>
            <div style={{ flex:1, fontSize:8, color:"#22c55e", fontFamily:"monospace" }}>{r.headroom}</div>
            <div style={{ flex:1, fontSize:8, color:r.color, fontFamily:"monospace", fontWeight:700 }}>{r.payoff}</div>
            <div style={{ flex:1, fontSize:8, color:"#e8e8e8", fontFamily:"monospace" }}>{r.interest}</div>
            <div style={{ flex:1, fontSize:8, color:r.savingsColor, fontFamily:"monospace" }}>{r.savings}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockBalanceChart() {
  const W = 420, H = 170, PAD = { t:10, r:10, b:28, l:44 };
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const maxMonths = 268, maxBal = 580000;
  const scaleX = (m) => PAD.l + (m / maxMonths) * innerW;
  const scaleY = (v) => PAD.t + (1 - v / maxBal) * innerH;
  const strategies = [
    { color:"#f97316", months:267, startBal:568000, rate:0.053 },
    { color:"#22c55e", months:224, startBal:573000, rate:0.044 },
    { color:"#3b82f6", months:180, startBal:573000, rate:0.035 },
  ];
  const buildPath = (s) => {
    const pts: string[] = [];
    for (let m=0; m<=s.months; m+=3) {
      const decay = Math.pow(1 - (m / s.months) * 0.92, 1.6);
      const bal = s.startBal * Math.max(0, decay);
      pts.push(`${m===0?"M":"L"}${scaleX(m).toFixed(1)},${scaleY(bal).toFixed(1)}`);
    }
    pts.push(`L${scaleX(s.months).toFixed(1)},${scaleY(0).toFixed(1)}`);
    return pts.join(" ");
  };
  const yTicks = [0, 150000, 300000, 450000, 580000];
  const xTicks = [0, 60, 120, 180, 240];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", background:"rgba(0,0,0,0.5)", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)", marginBottom:2 }}>
        <div style={{ width:18, height:18, borderRadius:4, background:"linear-gradient(135deg,#3b82f6,#22c55e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>⌂</div>
        <span style={{ fontSize:10, fontWeight:700, color:"#e8e8e8" }}>HomeLoan</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, padding:"10px 12px" }}>
        <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Remaining Balance Over Time</div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
          {/* grid */}
          {yTicks.map(v => <line key={v} x1={PAD.l} y1={scaleY(v)} x2={W-PAD.r} y2={scaleY(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />)}
          {xTicks.map(m => <line key={m} x1={scaleX(m)} y1={PAD.t} x2={scaleX(m)} y2={H-PAD.b} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />)}
          {/* 2-1 buydown rate step-up dashes (month 12, month 24) */}
          <line x1={scaleX(12)} y1={PAD.t} x2={scaleX(12)} y2={H-PAD.b} stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3,3" />
          <line x1={scaleX(24)} y1={PAD.t} x2={scaleX(24)} y2={H-PAD.b} stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3,3" />
          {/* y axis labels */}
          {yTicks.map(v => <text key={v} x={PAD.l-4} y={scaleY(v)+3} textAnchor="end" fill="#555" fontSize={7}>${v/1000}k</text>)}
          {/* x axis labels */}
          {xTicks.map(m => <text key={m} x={scaleX(m)} y={H-PAD.b+10} textAnchor="middle" fill="#555" fontSize={7}>{m/12}yr</text>)}
          {/* lines */}
          {strategies.map(s => <path key={s.color} d={buildPath(s)} stroke={s.color} strokeWidth={1.8} fill="none" />)}
          {/* payoff dots */}
          {strategies.map(s => <circle key={s.color+"dot"} cx={scaleX(s.months)} cy={scaleY(0)} r={3} fill={s.color} />)}
          {/* legend */}
          {[{color:"#f97316",label:"Buydown"},{color:"#22c55e",label:"Refi 30"},{color:"#3b82f6",label:"Refi 15"}].map((l,i) => (
            <g key={l.color} transform={`translate(${PAD.l + i*80},${H-5})`}>
              <line x1={0} y1={0} x2={14} y2={0} stroke={l.color} strokeWidth={1.5} />
              <text x={17} y={3} fill="#888" fontSize={7}>{l.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function MockInterestChart() {
  const W = 420, H = 170, PAD = { t:10, r:10, b:28, l:44 };
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const maxMonths = 268, maxInterest = 420000;
  const scaleX = (m) => PAD.l + (m / maxMonths) * innerW;
  const scaleY = (v) => PAD.t + (1 - v / maxInterest) * innerH;
  const curves = [
    { color:"#f97316", months:267, peak:412440 },
    { color:"#22c55e", months:224, peak:338201 },
    { color:"#3b82f6", months:180, peak:221084 },
  ];
  const buildPath = (c) => {
    const pts: string[] = [];
    for (let m=0; m<=c.months; m+=3) {
      const progress = m / c.months;
      const v = c.peak * (1 - Math.pow(1 - progress, 1.4));
      pts.push(`${m===0?"M":"L"}${scaleX(m).toFixed(1)},${scaleY(v).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const yTicks = [0, 100000, 200000, 300000, 400000];
  const xTicks = [0, 60, 120, 180, 240];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", background:"rgba(0,0,0,0.5)", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)", marginBottom:2 }}>
        <div style={{ width:18, height:18, borderRadius:4, background:"linear-gradient(135deg,#3b82f6,#22c55e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>⌂</div>
        <span style={{ fontSize:10, fontWeight:700, color:"#e8e8e8" }}>HomeLoan</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, padding:"10px 12px" }}>
        <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Cumulative Interest Paid</div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
          {yTicks.map(v => <line key={v} x1={PAD.l} y1={scaleY(v)} x2={W-PAD.r} y2={scaleY(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />)}
          {xTicks.map(m => <line key={m} x1={scaleX(m)} y1={PAD.t} x2={scaleX(m)} y2={H-PAD.b} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />)}
          {yTicks.map(v => <text key={v} x={PAD.l-4} y={scaleY(v)+3} textAnchor="end" fill="#555" fontSize={7}>${v/1000}k</text>)}
          {xTicks.map(m => <text key={m} x={scaleX(m)} y={H-PAD.b+10} textAnchor="middle" fill="#555" fontSize={7}>{m/12}yr</text>)}
          {/* gap shading between worst and best */}
          <path
            d={`${buildPath(curves[0])} L${scaleX(curves[2].months)},${scaleY(curves[2].peak)} ${buildPath(curves[2]).replace("M","L")} Z`}
            fill="rgba(34,197,94,0.06)"
          />
          {curves.map(c => <path key={c.color} d={buildPath(c)} stroke={c.color} strokeWidth={1.8} fill="none" />)}
          {/* savings callout */}
          <line x1={scaleX(180)} y1={scaleY(412440*0.82)} x2={scaleX(180)} y2={scaleY(221084)} stroke="rgba(34,197,94,0.4)" strokeWidth={1} strokeDasharray="3,2" />
          <text x={scaleX(180)+4} y={scaleY((412440*0.82+221084)/2)} fill="#22c55e" fontSize={7} fontWeight="600">$191k saved</text>
          {[{color:"#f97316",label:"Buydown"},{color:"#22c55e",label:"Refi 30"},{color:"#3b82f6",label:"Refi 15"}].map((l,i) => (
            <g key={l.color} transform={`translate(${PAD.l + i*80},${H-5})`}>
              <line x1={0} y1={0} x2={14} y2={0} stroke={l.color} strokeWidth={1.5} />
              <text x={17} y={3} fill="#888" fontSize={7}>{l.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function MockHeadroomChart() {
  const bars = [
    { name:"2-1 Buydown — Stay & Pay $5k",  color:"#f97316", min:3118, target:5000 },
    { name:"Refi 30-yr @ 5.3%",     color:"#22c55e", min:3142, target:5000 },
    { name:"Refi 15-yr @ 5.3%",     color:"#3b82f6", min:4533, target:5000 },
  ];
  const maxVal = 5400;
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", background:"rgba(0,0,0,0.5)", borderRadius:8, border:"1px solid rgba(255,255,255,0.07)", marginBottom:2 }}>
        <div style={{ width:18, height:18, borderRadius:4, background:"linear-gradient(135deg,#3b82f6,#22c55e)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>⌂</div>
        <span style={{ fontSize:10, fontWeight:700, color:"#e8e8e8" }}>HomeLoan</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, padding:"12px 14px" }}>
        <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Monthly Payment Breakdown & Headroom</div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {bars.map(b => {
            const minPct   = (b.min    / maxVal) * 100;
            const targetPct= (b.target / maxVal) * 100;
            const headroom = b.target - b.min;
            return (
              <div key={b.name}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <div style={{ width:5, height:5, borderRadius:"50%", background:b.color }} />
                    <span style={{ fontSize:8, fontWeight:600, color:"#ccc" }}>{b.name}</span>
                  </div>
                  <span style={{ fontSize:8, color:"#22c55e", fontFamily:"monospace", fontWeight:700 }}>+${headroom.toLocaleString()} headroom</span>
                </div>
                <div style={{ position:"relative", height:16, background:"rgba(255,255,255,0.05)", borderRadius:4, overflow:"hidden" }}>
                  {/* min payment bar */}
                  <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${minPct}%`, background:`${b.color}66`, borderRadius:"4px 0 0 4px" }} />
                  {/* headroom bar */}
                  <div style={{ position:"absolute", left:`${minPct}%`, top:0, height:"100%", width:`${targetPct - minPct}%`, background:"rgba(34,197,94,0.35)", borderRight:"1.5px solid #22c55e99" }} />
                  {/* labels */}
                  <span style={{ position:"absolute", left:`${minPct/2}%`, top:"50%", transform:"translate(-50%,-50%)", fontSize:7, color:"#ddd", fontFamily:"monospace", fontWeight:600 }}>${(b.min/1000).toFixed(1)}k min</span>
                  <span style={{ position:"absolute", left:`${(minPct+targetPct)/2}%`, top:"50%", transform:"translate(-50%,-50%)", fontSize:7, color:"#22c55e", fontFamily:"monospace", fontWeight:600 }}>+${(headroom/1000).toFixed(1)}k</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:14, marginTop:12 }}>
          {[{color:"rgba(255,165,0,0.5)", label:"Min P+I+Escrow"},{color:"rgba(34,197,94,0.35)", label:"Headroom (extra principal)"}].map(l => (
            <div key={l.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:10, height:6, borderRadius:2, background:l.color }} />
              <span style={{ fontSize:7, color:"#666" }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ONBOARDING_SLIDES = [
  {
    tag: "Welcome",
    headline: "Model your mortgage.",
    subheadline: "Compare strategies side-by-side.",
    body: "HomeLoan is a precision tool for homeowners who want to take control of their loan — whether you're in a 2-1 buydown approaching the permanent rate, weighing a refinance, or simply exploring how extra payments accelerate your payoff.",
    mock: MockSummaryCards,
  },
  {
    tag: "Compare",
    headline: "Every strategy, at a glance.",
    subheadline: "Side-by-side comparison table.",
    body: "Add multiple loan scenarios — your current 2-1 buydown, a 30-year refi, a 15-year refi — and see payoff dates, total interest costs, minimum payments, and your savings vs. the worst option, all in one row.",
    mock: MockComparisonTable,
  },
  {
    tag: "Payoff",
    headline: "See exactly when you're debt-free.",
    subheadline: "Balance trajectory over time.",
    body: "The balance chart plots every strategy on a shared timeline. Watch lines converge to zero at different dates — a 15-year refi clears the debt years ahead of staying in the 2-1 buydown at minimum payments.",
    mock: MockBalanceChart,
  },
  {
    tag: "Interest",
    headline: "Quantify the real cost.",
    subheadline: "Cumulative interest — the true price of each path.",
    body: "Refinancing into a 15-year loan can save over $191k in interest versus staying in a 2-1 buydown at minimum payments. The gap is highlighted directly on the chart so you never have to do the math yourself.",
    mock: MockInterestChart,
  },
  {
    tag: "Headroom",
    headline: "Know your monthly flexibility.",
    subheadline: "Headroom = target payment − minimum payment.",
    body: "Headroom shows how much above the minimum you're paying each month — that excess goes straight to principal. The breakdown chart makes it immediately clear which strategies leave you breathing room.",
    mock: MockHeadroomChart,
  },
];

function OnboardingCarousel({ onGetStarted, onLoadSample }: { onGetStarted: () => void; onLoadSample: () => void }) {
  const [slide, setSlide] = useState(0);
  const [dir, setDir]     = useState<1 | -1>(1);
  const [animKey, setAnimKey] = useState(0);
  const total = ONBOARDING_SLIDES.length;

  const go = (next: number, direction: 1 | -1) => {
    setDir(direction);
    setAnimKey(k => k + 1);
    setSlide(next);
  };
  const prev = () => go((slide - 1 + total) % total, -1);
  const next = () => go((slide + 1) % total,          1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slide]);

  const s = ONBOARDING_SLIDES[slide];
  const MockComponent = s.mock;
  const isLast = slide === total - 1;

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "28px 20px 36px",
      minHeight: "calc(100vh - 48px)",
      background: "radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.05) 0%, transparent 65%)",
    }}>
      <style>{`
        @keyframes slideInRight  { from { opacity:0; transform:translateX(48px);  } to { opacity:1; transform:translateX(0); } }
        @keyframes slideInLeft   { from { opacity:0; transform:translateX(-48px); } to { opacity:1; transform:translateX(0); } }
        .slide-enter-right { animation: slideInRight 0.32s cubic-bezier(0.22,1,0.36,1) both; }
        .slide-enter-left  { animation: slideInLeft  0.32s cubic-bezier(0.22,1,0.36,1) both; }
      `}</style>

      {/* Main card */}
      <div style={{
        width: "100%",
        maxWidth: 960,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        {/* Progress bar */}
        <div style={{ height: 2, background: "rgba(255,255,255,0.06)" }}>
          <div style={{
            height: "100%",
            width: `${((slide + 1) / total) * 100}%`,
            background: "linear-gradient(90deg, #3b82f6, #22c55e)",
            transition: "width 0.35s cubic-bezier(0.22,1,0.36,1)",
          }} />
        </div>

        <div style={{ display: "flex", minHeight: 440 }}>
          {/* Left: text panel */}
          <div style={{
            width: 280,
            flexShrink: 0,
            padding: "36px 32px 36px 36px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div>
              {/* Tag */}
              <div style={{
                display: "inline-block",
                fontSize: 10, fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#3b82f6",
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 20,
                padding: "3px 10px",
                marginBottom: 20,
              }}>{s.tag} {slide + 1}/{total}</div>

              {/* Headline */}
              <div style={{ fontSize: 24, fontWeight: 700, color: "#f0f0f0", lineHeight: 1.2, letterSpacing: "-0.02em", marginBottom: 8 }}>
                {s.headline}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#3b82f6", marginBottom: 18, letterSpacing: "-0.01em" }}>
                {s.subheadline}
              </div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.7 }}>
                {s.body}
              </div>
            </div>

            {/* CTAs — always visible, primary changes on last slide */}
            <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={onGetStarted}
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #22c55e)",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 20px",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                {isLast ? "Get Started →" : "Skip to Get Started →"}
              </button>
              <button
                onClick={onLoadSample}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  padding: "11px 20px",
                  color: "#888",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "color 0.15s, border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#ccc"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
              >
                Try with sample data
              </button>
            </div>
          </div>

          {/* Right: mock screenshot */}
          <div style={{
            flex: 1,
            minWidth: 0,
            padding: "24px 24px",
            display: "flex",
            alignItems: "center",
            background: "rgba(0,0,0,0.2)",
            overflow: "hidden",
          }}>
            <div
              key={`${slide}-${animKey}`}
              className={dir === 1 ? "slide-enter-right" : "slide-enter-left"}
              style={{ width: "100%", minWidth: 0 }}
            >
              <MockComponent />
            </div>
          </div>
        </div>

        {/* Bottom nav */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 28px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.15)",
        }}>
          {/* Dot indicators */}
          <div style={{ display: "flex", gap: 6 }}>
            {ONBOARDING_SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i, i > slide ? 1 : -1)}
                style={{
                  width: i === slide ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === slide ? "#3b82f6" : "rgba(255,255,255,0.15)",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "width 0.25s ease, background 0.2s ease",
                }}
              />
            ))}
          </div>

          {/* Arrow buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={prev}
              style={{
                width: 34, height: 34,
                borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#888",
                fontSize: 16,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#ddd"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#888"; }}
            >‹</button>
            <button
              onClick={next}
              style={{
                width: 34, height: 34,
                borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#888",
                fontSize: 16,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#ddd"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#888"; }}
            >›</button>
          </div>
        </div>
      </div>

      {/* Keyboard hint */}
      <div style={{ marginTop: 16, fontSize: 11, color: "#444", display: "flex", alignItems: "center", gap: 6 }}>
        <kbd style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:4, padding:"1px 6px", fontSize:10, color:"#666" }}>←</kbd>
        <kbd style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:4, padding:"1px 6px", fontSize:10, color:"#666" }}>→</kbd>
        <span>to navigate</span>
      </div>
    </div>
  );
}

// ─── HEADROOM SECTION ────────────────────────────────────────────────────────

function headroomColor(headroom) {
  if (headroom >= 300) return "#22c55e";
  if (headroom > 0)    return "#f97316";
  if (headroom === 0)  return "#555";
  return "#ef4444";
}

function HeadroomSection({ amortizations, strategies, headroomMaxVal, focusedId, onFocus }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12,
      padding: "16px 18px",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>
        Monthly Payment Flexibility
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {amortizations.map((a, i) => {
          const strat     = strategies[i];
          const targetVal = strat?.targetPayment ?? a.minPayment;
          const minPct    = (a.minPayment / headroomMaxVal) * 100;
          const targetPct = (targetVal    / headroomMaxVal) * 100;
          const isFocused = focusedId === a.id;
          const isDimmed  = focusedId && !isFocused;
          const hColor    = headroomColor(a.headroom);
          return (
            <div
              key={a.id}
              onClick={() => onFocus(isFocused ? null : a.id)}
              style={{ opacity: isDimmed ? 0.3 : 1, transition: "opacity 0.2s ease", cursor: "pointer" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: isFocused ? "#e8e8e8" : "#ccc" }}>{a.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {a.headroom < 0 && (
                    <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 600 }}>⚠ Negatively amortizing</span>
                  )}
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: hColor }}>
                    {a.headroom > 0 ? `+${fmt$(a.headroom)} headroom` : a.headroom === 0 ? "at minimum" : `${fmt$(Math.abs(a.headroom))} short`}
                  </span>
                </div>
              </div>
              <div style={{ position: "relative", height: 28, background: "rgba(255,255,255,0.05)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${Math.min(minPct, 100)}%`,
                  background: a.headroom < 0 ? "rgba(239,68,68,0.35)" : `${a.color}55`,
                  borderRadius: a.headroom > 0 ? "6px 0 0 6px" : "6px",
                  transition: "width 0.4s ease",
                }} />
                {a.headroom > 0 && (
                  <div style={{
                    position: "absolute", left: `${minPct}%`, top: 0, height: "100%",
                    width: `${targetPct - minPct}%`,
                    background: a.headroom >= 300 ? "rgba(34,197,94,0.25)" : "rgba(249,115,22,0.20)",
                    borderRight: `2px solid ${hColor}99`,
                    transition: "width 0.4s ease, left 0.4s ease",
                  }} />
                )}
                <span style={{
                  position: "absolute", left: `${minPct / 2}%`, top: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 10, color: "#ddd", fontFamily: "monospace", fontWeight: 600,
                  whiteSpace: "nowrap", pointerEvents: "none",
                }}>{fmt$(a.minPayment)} min</span>
                {a.headroom > 0 && (targetPct - minPct) > 8 && (
                  <span style={{
                    position: "absolute", left: `${(minPct + targetPct) / 2}%`, top: "50%",
                    transform: "translate(-50%, -50%)",
                    fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: hColor,
                    whiteSpace: "nowrap", pointerEvents: "none",
                  }}>+{fmt$(a.headroom)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 14, height: 8, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
          <span style={{ fontSize: 10, color: "#555" }}>Min P+I+Escrow</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 14, height: 8, borderRadius: 2, background: "rgba(34,197,94,0.22)", outline: "1.5px solid rgba(34,197,94,0.5)" }} />
          <span style={{ fontSize: 10, color: "#555" }}>Headroom — extra reduces principal faster</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 14, height: 8, borderRadius: 2, background: "rgba(249,115,22,0.20)", outline: "1.5px solid rgba(249,115,22,0.5)" }} />
          <span style={{ fontSize: 10, color: "#555" }}>Tight (&lt;$300/mo)</span>
        </div>
      </div>
    </div>
  );
}

// ─── COMPARISON PAGE ─────────────────────────────────────────────────────────

function ComparisonPage({ page, onUpdate }) {
  const [editMode, setEditMode] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [focusedId, setFocusedId] = useState(null);
  const [scheduleStratId, setScheduleStratId] = useState(null);
  const [activeTab, setActiveTab] = useState("charts");
  const [strategies, setStrategies] = useState(page.strategies);
  const [annualReturn, setAnnualReturn] = useState(0.07);
  const balanceChartRef = useRef(null);

  useEffect(() => {
    onUpdate({ ...page, strategies });
  }, [strategies]);

  const amortizations = useMemo(() =>
    strategies.map(s => ({ id: s.id, color: s.color, name: s.name, ...buildAmortization(s) })),
    [strategies]
  );

  const maxMonths = useMemo(() => Math.max(...amortizations.map(a => a.rows.length), 1), [amortizations]);

  const balanceData = useMemo(() =>
    Array.from({ length: maxMonths }, (_, i) => {
      const row = { month: i + 1 };
      amortizations.forEach(a => { row[a.name] = a.rows[i]?.balance ?? 0; });
      return row;
    }),
    [amortizations, maxMonths]
  );

  const interestData = useMemo(() =>
    Array.from({ length: maxMonths }, (_, i) => {
      const row = { month: i + 1 };
      amortizations.forEach(a => { row[a.name] = a.rows[i]?.totalInterest ?? a.totalInterest; });
      return row;
    }),
    [amortizations, maxMonths]
  );

  const headroomMaxVal = useMemo(() =>
    Math.max(...amortizations.map((a, i) => strategies[i]?.targetPayment ?? a.minPayment)),
    [amortizations, strategies]
  );

  // Winner badges + trade-off sentences
  const winners = useMemo(() => computeWinners(amortizations), [amortizations]);

  // ARM cliff banner: find the ARM strategy with the most urgent countdown
  const armBannerData = useMemo(() => {
    const armPairs = amortizations
      .map((a, i) => ({ a, s: strategies[i] }))
      .filter(({ a }) => a.armCountdown != null);
    if (armPairs.length === 0) return null;
    // Pick the one with the soonest non-zero step-up
    const active = armPairs.find(({ a }) => a.armCountdown.monthsToYear2 > 0 || a.armCountdown.monthsToYear3 > 0);
    if (!active) return null;
    return { ...active.a.armCountdown, balance: active.s.balance };
  }, [amortizations, strategies]);

  const addStrategy = () => {
    const idx = strategies.length % PALETTE.length;
    setStrategies([...strategies, {
      id: `s-${Date.now()}`,
      name: `Strategy ${strategies.length + 1}`,
      color: PALETTE[idx],
      loanType: "fixed",
      balance: 567992.60,
      escrow: 856.43,
      targetPayment: 5000,
      armRates: [0.04375, 0.05375, 0.06375],
      fixedRate: 0.053,
      fixedTerm: 30,
      closingCosts: 5000,
      currentLoanMonth: 0,
      armYear1Months: 12,
      armYear2Months: 12,
      windfalls: [],
    }]);
  };

  // helpers for focus-aware chart rendering
  const lineOpacity = (id) => focusedId ? (id === focusedId ? 1 : 0.1) : 1;
  const lineWidth  = (id) => focusedId ? (id === focusedId ? 2.5 : 1) : 2;

  // modal data
  const scheduleAmort = scheduleStratId ? amortizations.find(a => a.id === scheduleStratId) : null;
  const scheduleStrat = scheduleStratId ? strategies.find(s => s.id === scheduleStratId) : null;

  return (
    <div style={{ minHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column" }}>

      {/* Page header bar */}
      <div style={{ flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 28px",
          borderBottom: showLegend ? "none" : "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.3)",
        }}>
          <input
            value={page.title}
            onChange={e => onUpdate({ ...page, title: e.target.value })}
            style={inputStyle({ fontSize: 15, fontWeight: 700, background: "transparent", border: "none", width: "auto", minWidth: 200 })}
          />
          <div style={{ flex: 1 }} />
          {focusedId && (
            <button
              onClick={() => setFocusedId(null)}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#888",
                borderRadius: 7,
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              ✕ Clear focus
            </button>
          )}
          {/* Glossary toggle */}
          <button
            onClick={() => setShowLegend(v => !v)}
            title="Toggle glossary"
            style={{
              background: showLegend ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${showLegend ? "#a855f7" : "rgba(255,255,255,0.1)"}`,
              color: showLegend ? "#a855f7" : "#666",
              borderRadius: 7,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 600,
              letterSpacing: "0.01em",
            }}
          >
            ⓘ Glossary
          </button>
          <button
            onClick={() => setEditMode(!editMode)}
            style={{
              background: editMode ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${editMode ? "#3b82f6" : "rgba(255,255,255,0.12)"}`,
              color: editMode ? "#3b82f6" : "#aaa",
              borderRadius: 7,
              padding: "6px 14px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {editMode ? "✓ Done editing" : "⚙ Edit strategies"}
          </button>
        </div>
        {showLegend && <Legend onClose={() => setShowLegend(false)} />}
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar — edit mode only */}
        {editMode && (
          <div style={{
            width: 320,
            flexShrink: 0,
            padding: 20,
            borderRight: "1px solid rgba(255,255,255,0.07)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
              Define Strategies
            </div>
            {strategies.map((s, i) => (
              <StrategyForm
                key={s.id}
                strategy={s}
                index={i}
                onChange={updated => setStrategies(strategies.map(x => x.id === s.id ? updated : x))}
                onDelete={strategies.length > 1 ? () => setStrategies(strategies.filter(x => x.id !== s.id)) : null}
              />
            ))}
            <button onClick={addStrategy} style={{
              background: "transparent",
              border: "1px dashed rgba(255,255,255,0.2)",
              color: "#666",
              borderRadius: 10,
              padding: "10px",
              fontSize: 12,
              cursor: "pointer",
            }}>
              + Add strategy
            </button>
          </div>
        )}

        {/* Empty state: onboarding carousel */}
        {strategies.length === 0 && !editMode && (
          <OnboardingCarousel
            onGetStarted={() => {
              addStrategy();
              setEditMode(true);
            }}
            onLoadSample={() => setStrategies(DEFAULT_STRATEGIES)}
          />
        )}

        {/* Main dashboard */}
        {strategies.length > 0 && <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

          {/* ARM cliff banner — above everything, full width */}
          {armBannerData && (
            <ARMCliffBanner
              {...armBannerData}
              onScrollToChart={() => {
                setActiveTab("charts");
                setTimeout(() => balanceChartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }}
            />
          )}

          <div style={{ flex: 1, padding: "24px 28px" }}>
          {/* Summary cards */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Strategy Comparison</span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#666" }}>
              <span>Invest after payoff @</span>
              <input
                type="number"
                min={0} max={30} step={0.5}
                value={(annualReturn * 100).toFixed(1)}
                onChange={e => setAnnualReturn(Math.min(0.30, Math.max(0, parseFloat(e.target.value) / 100 || 0)))}
                onClick={e => e.stopPropagation()}
                style={{
                  width: 46, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 4, color: "#ccc", fontSize: 11, padding: "2px 5px", textAlign: "center",
                  fontFamily: "monospace",
                }}
              />
              <span style={{ color: "#555" }}>% / yr</span>
            </label>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(Math.max(strategies.length, 1), 3)}, 1fr)`,
            gap: 12,
            marginBottom: 28,
          }}>
            {amortizations.map((a, i) => {
              const isFocused = focusedId === a.id;
              const isDimmed = focusedId && !isFocused;
              const tradeoff = generateTradeoff(a, amortizations, winners);
              const freeCashMonths = Math.max(0, maxMonths - a.monthsToPayoff);
              const monthlyContrib = strategies[i]?.targetPayment ?? a.minPayment;
              const projectedValue = freeCashMonths > 0
                ? projectInvestment(monthlyContrib, freeCashMonths, annualReturn)
                : 0;
              const badgeStyle = (bg, border, color) => ({
                display: "inline-block",
                padding: "2px 7px",
                borderRadius: 10,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.06em",
                background: bg,
                border: `1px solid ${border}`,
                color,
              });
              return (
                <div
                  key={a.id}
                  onClick={() => setFocusedId(isFocused ? null : a.id)}
                  style={{
                    background: isFocused ? `rgba(${hexToRgb(a.color)}, 0.07)` : "rgba(255,255,255,0.03)",
                    border: isFocused ? `1.5px solid ${a.color}99` : `1px solid ${a.color}33`,
                    borderRadius: 12,
                    padding: "16px 18px",
                    cursor: "pointer",
                    opacity: isDimmed ? 0.38 : 1,
                    transition: "opacity 0.2s ease, border-color 0.15s ease, background 0.15s ease",
                    boxShadow: isFocused ? `0 0 0 1px ${a.color}33, 0 4px 20px ${a.color}18` : "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                  }}
                >
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: isFocused ? "#e8e8e8" : "#ccc", flex: 1 }}>{a.name}</span>
                    {isFocused && <span style={{ fontSize: 9, color: a.color, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>focused</span>}
                  </div>

                  {/* Winner badges */}
                  {winners && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10, minHeight: 20 }}>
                      {winners.lowestInterest === a.id && (
                        <span style={badgeStyle("rgba(34,197,94,0.12)", "rgba(34,197,94,0.35)", "#22c55e")}>Lowest Interest</span>
                      )}
                      {winners.mostHeadroom === a.id && (
                        <span style={badgeStyle("rgba(59,130,246,0.12)", "rgba(59,130,246,0.35)", "#3b82f6")}>Most Headroom</span>
                      )}
                      {winners.fastestPayoff === a.id && (
                        <span style={badgeStyle("rgba(168,85,247,0.12)", "rgba(168,85,247,0.35)", "#a855f7")}>Fastest Payoff</span>
                      )}
                    </div>
                  )}

                  {/* Metric grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Payoff</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: a.color, fontFamily: "monospace" }}>{fmtYr(a.yearsToPayoff)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Interest</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8e8", fontFamily: "monospace" }}>{fmtK(a.totalInterest)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Min Payment</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#bbb", fontFamily: "monospace" }}>{fmt$(a.minPayment)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Headroom</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: headroomColor(a.headroom), fontFamily: "monospace" }}>{fmt$(a.headroom)}</div>
                    </div>
                  </div>

                  {/* Trade-off sentence */}
                  <div style={{
                    fontSize: 11, color: "#666", fontStyle: "italic",
                    paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)",
                    marginBottom: 8, lineHeight: 1.5,
                  }}>
                    {tradeoff}
                  </div>

                  {/* Investment projection callout */}
                  {freeCashMonths > 0 ? (
                    <div style={{
                      marginBottom: 8,
                      padding: "8px 10px",
                      borderRadius: 7,
                      background: "rgba(34,197,94,0.06)",
                      border: "1px solid rgba(34,197,94,0.15)",
                    }}>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Invest after payoff · {Math.round(freeCashMonths / 12 * 10) / 10} yrs
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>
                          {projectedValue >= 1e6
                            ? "$" + (projectedValue / 1e6).toFixed(2) + "M"
                            : "$" + Math.round(projectedValue / 1000) + "k"}
                        </span>
                        <span style={{ fontSize: 10, color: "#555" }}>
                          investing {fmt$(monthlyContrib)}/mo
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      marginBottom: 8, padding: "8px 10px", borderRadius: 7,
                      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                        Invest after payoff
                      </div>
                      <div style={{ fontSize: 11, color: "#444" }}>Longest payoff — set the horizon</div>
                    </div>
                  )}

                  {/* Schedule button */}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={e => { e.stopPropagation(); setScheduleStratId(a.id); }}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#666",
                        borderRadius: 5,
                        padding: "4px 10px",
                        fontSize: 10,
                        cursor: "pointer",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        transition: "color 0.15s, border-color 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "#666"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                    >
                      ≡ Schedule
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Headroom gauge — always visible above tabs */}
          <HeadroomSection
            amortizations={amortizations}
            strategies={strategies}
            headroomMaxVal={headroomMaxVal}
            focusedId={focusedId}
            onFocus={setFocusedId}
          />

          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 20 }}>
            {[{ id: "charts", label: "Charts" }, { id: "table", label: "Detailed Table" }].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "8px 20px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === tab.id ? "#7c6af7" : "transparent"}`,
                  marginBottom: "-1px",
                  color: activeTab === tab.id ? "#e8e8e8" : "#555",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  letterSpacing: "0.01em",
                  transition: "color 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── CHARTS TAB ─────────────────────────────────────────────── */}
          {activeTab === "charts" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div ref={balanceChartRef}>
            <ChartCard title="Remaining Balance Over Time">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={balanceData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                    ticks={xTicks(maxMonths)} tickFormatter={v => `${v / 12}yr`} />
                  <YAxis tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                    tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={48} />
                  <Tooltip content={<CustomTooltip />} />
                  {amortizations.map(a => (
                    <Line
                      key={a.id}
                      type="monotone"
                      dataKey={a.name}
                      stroke={a.color}
                      strokeWidth={lineWidth(a.id)}
                      strokeOpacity={lineOpacity(a.id)}
                      dot={false}
                    />
                  ))}
                  {/* ARM cliff reference lines with labels */}
                  {armBannerData && armBannerData.monthsToYear2 > 0 && (
                    <ReferenceLine x={armBannerData.monthsToYear2} stroke="rgba(249,115,22,0.35)" strokeDasharray="4 3">
                      <Label value={`→ ${(armBannerData.year2Rate * 100).toFixed(3)}%`} position="insideTopRight" fill="#f97316" fontSize={9} />
                    </ReferenceLine>
                  )}
                  {armBannerData && armBannerData.monthsToYear3 > 0 && (
                    <ReferenceLine x={armBannerData.monthsToYear3} stroke="rgba(239,68,68,0.35)" strokeDasharray="4 3">
                      <Label value={`→ ${(armBannerData.year3Rate * 100).toFixed(3)}%`} position="insideTopRight" fill="#ef4444" fontSize={9} />
                    </ReferenceLine>
                  )}
                  {/* Fallback: static lines when no ARM banner data */}
                  {!armBannerData && (
                    <>
                      <ReferenceLine x={12} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                      <ReferenceLine x={24} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                    </>
                  )}
                  {/* Payoff dots at y=0 for each strategy */}
                  {amortizations.map(a => (
                    <ReferenceDot
                      key={`dot-${a.id}`}
                      x={a.monthsToPayoff}
                      y={0}
                      r={4}
                      fill={a.color}
                      stroke="none"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            </div>{/* end balanceChartRef wrapper */}

            <ChartCard title="Cumulative Interest Paid">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={interestData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                    ticks={xTicks(maxMonths)} tickFormatter={v => `${v / 12}yr`} />
                  <YAxis tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                    tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={48} />
                  <Tooltip content={<CustomTooltip />} />
                  {amortizations.map(a => (
                    <Line
                      key={a.id}
                      type="monotone"
                      dataKey={a.name}
                      stroke={a.color}
                      strokeWidth={lineWidth(a.id)}
                      strokeOpacity={lineOpacity(a.id)}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Headroom gauge moved above tab bar */}

            {amortizations.map(a => (
              <ChartCard
                key={a.id}
                title={`${a.name} — P&I Breakdown`}
                dimmed={focusedId != null && a.id !== focusedId}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart
                    data={a.rows.map(r => ({ month: r.month, Interest: r.interest, Principal: r.principal }))}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                      ticks={xTicks(a.rows.length)} tickFormatter={v => `${v / 12}yr`} />
                    <YAxis tick={{ fill: "#555", fontSize: 10 }} tickLine={false}
                      tickFormatter={v => "$" + (v / 1000).toFixed(1) + "k"} width={48} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="Interest" stroke="#f97316" fill="#f9731633" strokeWidth={1.5} />
                    <Area type="monotone" dataKey="Principal" stroke="#22c55e" fill="#22c55e22" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            ))}
          </div>}

          {/* ── TABLE TAB ──────────────────────────────────────────────── */}
          {activeTab === "table" && (
            <div style={{ marginBottom: 32 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Strategy", "Target Payment", "Min Payment", "Headroom", "Payoff", "Total Interest", "Savings vs Worst"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#555", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {amortizations.map((a, i) => {
                    const worstInterest = Math.max(...amortizations.map(x => x.totalInterest));
                    const savings = worstInterest - a.totalInterest;
                    const strat = strategies[i];
                    const isFocused = focusedId === a.id;
                    const isDimmed = focusedId && !isFocused;
                    return (
                      <tr
                        key={a.id}
                        onClick={() => setFocusedId(isFocused ? null : a.id)}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          opacity: isDimmed ? 0.3 : 1,
                          transition: "opacity 0.2s ease",
                          cursor: "pointer",
                          background: isFocused ? `rgba(${hexToRgb(a.color)}, 0.05)` : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.color }} />
                            <span style={{ color: "#ccc", fontWeight: 600 }}>{a.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#bbb", fontFamily: "monospace" }}>{fmt$(strat.targetPayment)}</td>
                        <td style={{ padding: "10px 12px", color: "#bbb", fontFamily: "monospace" }}>{fmt$(a.minPayment)}</td>
                        <td style={{ padding: "10px 12px", fontFamily: "monospace", color: a.headroom > 0 ? "#22c55e" : a.headroom === 0 ? "#555" : "#f97316" }}>{fmt$(a.headroom)}</td>
                        <td style={{ padding: "10px 12px", color: a.color, fontFamily: "monospace", fontWeight: 700 }}>{fmtYr(a.yearsToPayoff)}</td>
                        <td style={{ padding: "10px 12px", color: "#e8e8e8", fontFamily: "monospace" }}>{fmt$(a.totalInterest)}</td>
                        <td style={{ padding: "10px 12px", fontFamily: "monospace", color: savings > 0 ? "#22c55e" : "#666" }}>
                          {savings > 0 ? `+${fmt$(savings)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>{/* end padding wrapper */}
        </div>}
      </div>

      {/* Amortization schedule modal */}
      {scheduleAmort && scheduleStrat && (
        <ScheduleModal
          amort={scheduleAmort}
          strategy={scheduleStrat}
          onClose={() => setScheduleStratId(null)}
        />
      )}
    </div>
  );
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

/** Returns evenly-spaced month tick positions that will always render labels.
 *  ≤10 yrs → every year | ≤20 yrs → every 2 yrs | >20 yrs → every 5 yrs */
function xTicks(totalMonths) {
  const interval = totalMonths <= 120 ? 12 : totalMonths <= 240 ? 24 : 60;
  const ticks = [];
  for (let m = interval; m <= totalMonths; m += interval) ticks.push(m);
  return ticks;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────

const defaultPage = () => ({
  id: `page-${Date.now()}`,
  title: "Comparison 1",
  strategies: import.meta.env.DEV ? DEFAULT_STRATEGIES : [],
  createdAt: new Date().toISOString(),
});

export default function App() {
  const [pages, setPages] = useState(() => {
    const saved = loadPages();
    return saved || [defaultPage()];
  });
  const [activePageId, setActivePageId] = useState(() => {
    const saved = loadPages();
    return saved?.[0]?.id || null;
  });

  useEffect(() => {
    savePages(pages);
  }, [pages]);

  const activePage = pages.find(p => p.id === activePageId) || pages[0];

  const addPage = () => {
    const p = { ...defaultPage(), title: `Comparison ${pages.length + 1}`, strategies: [] };
    setPages(prev => [...prev, p]);
    setActivePageId(p.id);
  };

  const deletePage = (id) => {
    if (pages.length === 1) return;
    const newPages = pages.filter(p => p.id !== id);
    setPages(newPages);
    if (activePageId === id) setActivePageId(newPages[0].id);
  };

  const updatePage = useCallback((updated) => {
    setPages(prev => prev.map(p => p.id === updated.id ? updated : p));
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d0d0d",
      color: "#e8e8e8",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');
        body { margin: 0; }
        * { box-sizing: border-box; }
        input, select { font-family: inherit; }
        input:focus, select:focus { outline: none; border-color: rgba(255,255,255,0.3) !important; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      `}</style>

      {/* Top nav */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "#0a0a0a",
        height: 48,
        flexShrink: 0,
        overflowX: "auto",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 20, borderRight: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: "linear-gradient(135deg, #3b82f6, #22c55e)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700,
          }}>⌂</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8", letterSpacing: "-0.02em" }}>HomeLoan</span>
        </div>

        {/* Page tabs */}
        <div style={{ display: "flex", flex: 1, overflowX: "auto", paddingLeft: 8 }}>
          {pages.map(p => (
            <div
              key={p.id}
              onClick={() => setActivePageId(p.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "0 14px",
                height: 48,
                cursor: "pointer",
                borderBottom: p.id === activePageId ? "2px solid #3b82f6" : "2px solid transparent",
                color: p.id === activePageId ? "#e8e8e8" : "#666",
                fontSize: 12,
                fontWeight: p.id === activePageId ? 600 : 400,
                flexShrink: 0,
                transition: "color 0.15s",
              }}
            >
              <span>{p.title}</span>
              <span style={{ fontSize: 9, color: "#444" }}>
                {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              {pages.length > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); deletePage(p.id); }}
                  style={{ color: "#444", fontSize: 14, lineHeight: 1, marginLeft: 2, padding: "0 2px" }}
                >×</span>
              )}
            </div>
          ))}
          <button
            onClick={addPage}
            style={{
              background: "none", border: "none", color: "#555", fontSize: 18,
              cursor: "pointer", padding: "0 12px", height: 48, flexShrink: 0,
            }}
          >+</button>
        </div>
      </div>

      {/* Active page */}
      {activePage && (
        <ComparisonPage
          key={activePage.id}
          page={activePage}
          onUpdate={updatePage}
        />
      )}
    </div>
  );
}
