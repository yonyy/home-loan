// @ts-nocheck
import { useState, useMemo, useCallback, useEffect } from "react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── MORTGAGE ENGINE ────────────────────────────────────────────────────────

function calcFixedPI(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function buildAmortization(strategy) {
  const { balance, escrow, targetPayment, loanType, armRates, fixedRate, fixedTerm, closingCosts } = strategy;
  const startBalance = loanType === "refi" ? balance + (closingCosts || 0) : balance;

  const minPI = loanType === "arm"
    ? calcFixedPI(startBalance, armRates?.[0] || 0.04375, 30)
    : calcFixedPI(startBalance, fixedRate, fixedTerm);
  const effectivePayment = targetPayment != null ? targetPayment : minPI + escrow;

  const rows = [];
  let remaining = startBalance;
  let month = 1;
  let totalInterest = 0;

  while (remaining > 0.01 && month <= 480) {
    let rate;
    if (loanType === "arm") {
      if (month <= 12) rate = armRates[0] / 12;
      else if (month <= 24) rate = armRates[1] / 12;
      else rate = armRates[2] / 12;
    } else {
      rate = fixedRate / 12;
    }

    const interest = remaining * rate;
    totalInterest += interest;
    const available = effectivePayment - escrow - interest;
    let principal = Math.max(0, Math.min(available, remaining));

    remaining = Math.max(0, remaining - principal);

    rows.push({
      month,
      balance: remaining,
      interest,
      principal,
      totalInterest,
      payment: principal + interest + escrow,
    });

    if (remaining < 0.01) break;
    month++;
  }

  const minPayment = loanType === "arm"
    ? calcFixedPI(startBalance, (armRates?.[0] || 0.04375), 30) + escrow
    : calcFixedPI(startBalance, fixedRate, fixedTerm) + escrow;

  return {
    rows,
    monthsToPayoff: rows.length,
    yearsToPayoff: rows.length / 12,
    totalInterest,
    minPayment,
    headroom: (targetPayment || 0) - minPayment,
  };
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const DEFAULT_STRATEGIES = [
  {
    id: "arm-5k",
    name: "ARM — Stay & Pay $5k",
    color: "#f97316",
    loanType: "arm",
    balance: 567992.60,
    escrow: 856.43,
    targetPayment: 5000,
    armRates: [0.04375, 0.05375, 0.06375],
    fixedRate: 0.053,
    fixedTerm: 30,
    closingCosts: 0,
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
  const headers = ["Month", "Year", "Payment", "Principal", "Interest", "Escrow", "Balance", "Cumul. Interest"];
  const lines = [headers.join(",")];
  amort.rows.forEach(r => {
    lines.push([
      r.month,
      Math.ceil(r.month / 12),
      r.payment.toFixed(2),
      r.principal.toFixed(2),
      r.interest.toFixed(2),
      strategy.escrow.toFixed(2),
      r.balance.toFixed(2),
      r.totalInterest.toFixed(2),
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
  const upd = (field, val) => onChange({ ...strategy, [field]: val });
  const updNum = (field, val) => onChange({ ...strategy, [field]: val === "" ? "" : parseFloat(val) || 0 });

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
            <option value="arm">ARM</option>
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
        </>}
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

function ChartCard({ title, children, dimmed = false, note = null }) {
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
      {note && (
        <div style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.05)",
          fontSize: 10,
          color: "#4a4a4a",
          lineHeight: 1.5,
          display: "flex",
          alignItems: "flex-start",
          gap: 5,
        }}>
          <span style={{ color: "#3a3a3a", flexShrink: 0 }}>ⓘ</span>
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

// ─── SCHEDULE MODAL ──────────────────────────────────────────────────────────

function ScheduleModal({ amort, strategy, onClose }) {
  const tableRows = [];
  let prevYear = 0;
  amort.rows.forEach((r, i) => {
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
                {["Mo", "Yr", "Payment", "Principal", "Interest", "Escrow", "Balance", "Cumul. Interest"].map(h => (
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
                      <td colSpan={8} style={{
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
                return (
                  <tr key={item.key} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#555", fontFamily: "monospace" }}>{r.month}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#3a3a3a", fontFamily: "monospace" }}>{Math.ceil(r.month / 12)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#bbb", fontFamily: "monospace" }}>{fmt$(r.payment)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#22c55e", fontFamily: "monospace" }}>{fmt$(r.principal)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#f97316", fontFamily: "monospace" }}>{fmt$(r.interest)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#666", fontFamily: "monospace" }}>{fmt$(strategy.escrow)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#e8e8e8", fontFamily: "monospace", fontWeight: 600 }}>{fmt$(r.balance)}</td>
                    <td style={{ padding: "5px 14px", textAlign: "right", color: "#555", fontFamily: "monospace" }}>{fmt$(r.totalInterest)}</td>
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
    def: "Vertical dashed lines at Month 12 and Month 24 mark the ARM rate step-up points. Month 12: the rate adjusts from Year-1 rate to Year-2 rate. Month 24: it steps again to the Year-3+ rate. Only relevant for ARM strategies — fixed/refi strategies are unaffected by these boundaries.",
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

// ─── COMPARISON PAGE ─────────────────────────────────────────────────────────

function ComparisonPage({ page, onUpdate }) {
  const [editMode, setEditMode] = useState(page.strategies.length === 0);
  const [showLegend, setShowLegend] = useState(false);
  const [focusedId, setFocusedId] = useState(null);
  const [scheduleStratId, setScheduleStratId] = useState(null);
  const [strategies, setStrategies] = useState(page.strategies);

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

        {/* Main dashboard */}
        <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>

          {/* Summary cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(Math.max(strategies.length, 1), 3)}, 1fr)`,
            gap: 12,
            marginBottom: 28,
          }}>
            {amortizations.map(a => {
              const isFocused = focusedId === a.id;
              const isDimmed = focusedId && !isFocused;
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
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: isFocused ? "#e8e8e8" : "#ccc", flex: 1 }}>{a.name}</span>
                    {isFocused && <span style={{ fontSize: 9, color: a.color, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>focused</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
                      <div style={{ fontSize: 13, fontWeight: 600, color: a.headroom > 0 ? "#22c55e" : "#f97316", fontFamily: "monospace" }}>{fmt$(a.headroom)}</div>
                    </div>
                  </div>
                  {/* Schedule button */}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "flex-end" }}>
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

          {/* Charts grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
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
                  <ReferenceLine x={12} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <ReferenceLine x={24} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

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

            {amortizations.map(a => (
              <ChartCard
                key={a.id}
                title={`${a.name} — P&I Breakdown`}
                dimmed={focusedId != null && a.id !== focusedId}
                note={
                  amortizations.length > 1
                    ? `Per-strategy view — Principal (green) + Interest (orange) stack to equal the total P&I payment. Each strategy has its own chart; stacking multiple loans would produce meaningless totals. Compare all ${amortizations.length} strategies in the Balance and Cumulative Interest charts above.`
                    : null
                }
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
                    <Area type="monotone" dataKey="Interest" stackId="1" stroke="#f97316" fill="#f9731622" strokeWidth={1.5} />
                    <Area type="monotone" dataKey="Principal" stackId="1" stroke="#22c55e" fill="#22c55e22" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            ))}
          </div>

          {/* Comparison table */}
          {amortizations.length > 1 && (
            <div style={{ marginTop: 24, marginBottom: 32 }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Strategy Comparison</div>
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
                        <td style={{ padding: "10px 12px", fontFamily: "monospace", color: a.headroom > 0 ? "#22c55e" : "#f97316" }}>{fmt$(a.headroom)}</td>
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
        </div>
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
  strategies: DEFAULT_STRATEGIES,
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
