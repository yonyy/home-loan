import { useState } from 'react';
import type { LoanInputs } from '../types/loan.types';
import { DEFAULT_INPUTS } from '../types/loan.types';
import type { DerivedValues } from '../hooks/useDerivedValues';
import { formatCurrency, formatRate } from '../logic/dateUtils';

interface InputPanelProps {
  inputs: LoanInputs;
  onChange: (inputs: LoanInputs) => void;
  derived: DerivedValues;
}

type SectionKey = 'identity' | 'arm' | 'payment' | 'quarterly' | 'refi' | 'buydown' | 'investment';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function Section({
  id, label, open, onToggle, children,
}: { id: SectionKey; label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="input-section">
      <button className="input-section__header" onClick={onToggle}>
        {label}
        <span className={`input-section__chevron${open ? ' input-section__chevron--open' : ''}`}>▼</span>
      </button>
      {open && <div className="input-section__body">{children}</div>}
    </div>
  );
}

function SliderField({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="field--row" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="field__label">{label}</span>
        <span className="field__value">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function NumberField({
  label, value, onChange, prefix = '', suffix = '',
}: { label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {prefix && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{ flex: 1 }}
        />
        {suffix && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function ToggleField({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function InputPanel({ inputs, onChange, derived }: InputPanelProps) {
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    identity: true,
    arm: true,
    payment: true,
    quarterly: true,
    refi: true,
    buydown: false,
    investment: false,
  });

  const toggle = (key: SectionKey) => setOpen(p => ({ ...p, [key]: !p[key] }));
  const set = (partial: Partial<LoanInputs>) => onChange({ ...inputs, ...partial });

  return (
    <div className="input-panel">
      {/* ── Loan Identity ─────────────────────────────────────── */}
      <Section id="identity" label="Loan Identity" open={open.identity} onToggle={() => toggle('identity')}>
        <NumberField label="Original Principal ($)" value={inputs.originalPrincipal}
          onChange={v => set({ originalPrincipal: v })} prefix="$" />

        <div className="field">
          <span className="field__label">Loan Start</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={inputs.loanStartMonth}
              onChange={e => set({ loanStartMonth: parseInt(e.target.value) })}
              style={{ flex: 1 }}
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input
              type="number"
              value={inputs.loanStartYear}
              onChange={e => set({ loanStartYear: parseInt(e.target.value) || 2025 })}
              style={{ width: 72 }}
            />
          </div>
        </div>

        {/* Current Month — two input modes */}
        <div className="field">
          <span className="field__label">Current Month (months elapsed)</span>
          <input
            type="number"
            value={inputs.currentMonth}
            min={1}
            onChange={e => set({ currentMonth: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })}
          />
        </div>

        {/* Alternative: pick a calendar month/year and auto-calculate */}
        <div className="field">
          <span className="field__label" style={{ color: 'var(--color-text-dim)' }}>
            — or pick current date →
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              defaultValue=""
              style={{ flex: 1 }}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number);
                if (!y || !m) return;
                // months elapsed = (year diff * 12) + month diff + 1
                const elapsed = (y - inputs.loanStartYear) * 12 + (m - inputs.loanStartMonth) + 1;
                if (elapsed >= 1) set({ currentMonth: elapsed });
              }}
            >
              <option value="" disabled>Select date…</option>
              {(() => {
                const opts = [];
                const startTotal = inputs.loanStartYear * 12 + (inputs.loanStartMonth - 1);
                const nowTotal = new Date().getFullYear() * 12 + new Date().getMonth();
                for (let t = startTotal; t <= nowTotal + 24; t++) {
                  const yr = Math.floor(t / 12);
                  const mo = t % 12; // 0-based
                  const elapsed = t - startTotal + 1;
                  opts.push(
                    <option key={t} value={`${yr}-${mo + 1}`}>
                      {MONTHS[mo]} {yr} (Mo {elapsed})
                    </option>
                  );
                }
                return opts;
              })()}
            </select>
          </div>
        </div>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field__label">Current Balance ($)</span>
            <ToggleField label="Manual" checked={inputs.balanceIsManualOverride}
              onChange={v => set({ balanceIsManualOverride: v })} />
          </div>
          {inputs.balanceIsManualOverride ? (
            <input type="number" value={inputs.currentBalance}
              onChange={e => set({ currentBalance: parseFloat(e.target.value) || 0 })} />
          ) : (
            <div className="read-only-value">{formatCurrency(derived.autoBalance)}</div>
          )}
        </div>

        <NumberField label="Monthly Escrow ($)" value={inputs.escrow}
          onChange={v => set({ escrow: v })} prefix="$" />

        <div className="field">
          <span className="field__label">Original Term</span>
          <select value={inputs.originalTermYears}
            onChange={e => set({ originalTermYears: parseInt(e.target.value) })}>
            {[15, 20, 25, 30].map(y => <option key={y} value={y}>{y} years</option>)}
          </select>
        </div>
      </Section>

      {/* ── ARM Rate Structure ─────────────────────────────────── */}
      <Section id="arm" label="ARM Rate Structure" open={open.arm} onToggle={() => toggle('arm')}>
        <SliderField label="Year 1 Rate" value={inputs.armRates.year1Rate}
          min={0.01} max={0.10} step={0.00125}
          format={formatRate}
          onChange={v => set({ armRates: { ...inputs.armRates, year1Rate: v } })} />

        <SliderField label="Year 2 Rate" value={inputs.armRates.year2Rate}
          min={0.01} max={0.10} step={0.00125}
          format={formatRate}
          onChange={v => set({ armRates: { ...inputs.armRates, year2Rate: v } })} />

        <SliderField label="Year 3+ Rate" value={inputs.armRates.year3PlusRate}
          min={0.01} max={0.10} step={0.00125}
          format={formatRate}
          onChange={v => set({ armRates: { ...inputs.armRates, year3PlusRate: v } })} />

        <div style={{ display: 'flex', gap: 8 }}>
          <NumberField label="Yr 1 Duration (mo)" value={inputs.armRates.year1DurationMonths}
            onChange={v => set({ armRates: { ...inputs.armRates, year1DurationMonths: Math.max(1, Math.round(v)) } })} />
          <NumberField label="Yr 2 Duration (mo)" value={inputs.armRates.year2DurationMonths}
            onChange={v => set({ armRates: { ...inputs.armRates, year2DurationMonths: Math.max(1, Math.round(v)) } })} />
        </div>

        <div>
          <ToggleField label="Auto-calculate standard payments"
            checked={inputs.standardPayments.useAutoCalculate}
            onChange={v => set({ standardPayments: { ...inputs.standardPayments, useAutoCalculate: v } })} />

          {!inputs.standardPayments.useAutoCalculate ? (
            <>
              <NumberField label="Yr 1 P+I ($)" value={inputs.standardPayments.year1}
                onChange={v => set({ standardPayments: { ...inputs.standardPayments, year1: v } })} prefix="$" />
              <NumberField label="Yr 2 P+I ($)" value={inputs.standardPayments.year2}
                onChange={v => set({ standardPayments: { ...inputs.standardPayments, year2: v } })} prefix="$" />
              <NumberField label="Yr 3+ P+I ($)" value={inputs.standardPayments.year3Plus}
                onChange={v => set({ standardPayments: { ...inputs.standardPayments, year3Plus: v } })} prefix="$" />
            </>
          ) : (
            <div className="read-only-value" style={{ fontSize: 11, marginTop: 4 }}>
              Yr1: {formatCurrency(derived.autoStandardPayments.year1)} ·
              Yr2: {formatCurrency(derived.autoStandardPayments.year2)} ·
              Yr3+: {formatCurrency(derived.autoStandardPayments.year3Plus)}
            </div>
          )}
        </div>
      </Section>

      {/* ── Payment Strategy ───────────────────────────────────── */}
      <Section id="payment" label="Payment Strategy" open={open.payment} onToggle={() => toggle('payment')}>
        <SliderField label="Target Monthly Payment"
          value={inputs.targetMonthlyPayment}
          min={3000} max={10000} step={50}
          format={v => formatCurrency(v)}
          onChange={v => set({ targetMonthlyPayment: v })} />
      </Section>

      {/* ── Quarterly Extra Principal ──────────────────────────── */}
      <Section id="quarterly" label="Quarterly Extra Principal" open={open.quarterly} onToggle={() => toggle('quarterly')}>
        <ToggleField label="Enable quarterly payments"
          checked={inputs.quarterly.enabled}
          onChange={v => set({ quarterly: { ...inputs.quarterly, enabled: v } })} />

        {inputs.quarterly.enabled && (
          <>
            <SliderField label="Extra Principal"
              value={inputs.quarterly.amount}
              min={0} max={25000} step={500}
              format={v => formatCurrency(v)}
              onChange={v => set({ quarterly: { ...inputs.quarterly, amount: v } })} />

            <div className="field">
              <span className="field__label">Interval</span>
              <select value={inputs.quarterly.intervalMonths}
                onChange={e => set({ quarterly: { ...inputs.quarterly, intervalMonths: parseInt(e.target.value) } })}>
                {[2, 3, 4, 6].map(n => <option key={n} value={n}>Every {n} months</option>)}
              </select>
            </div>

            <NumberField label="First Payment Month" value={inputs.quarterly.firstPaymentMonth}
              onChange={v => set({ quarterly: { ...inputs.quarterly, firstPaymentMonth: Math.max(1, Math.round(v)) } })} />
          </>
        )}
      </Section>

      {/* ── Refinance ─────────────────────────────────────────── */}
      <Section id="refi" label="Refinance" open={open.refi} onToggle={() => toggle('refi')}>
        <SliderField label="Refi Rate"
          value={inputs.refi.annualRate}
          min={0.03} max={0.09} step={0.0005}
          format={formatRate}
          onChange={v => set({ refi: { ...inputs.refi, annualRate: v } })} />

        <NumberField label="Term (years)" value={inputs.refi.termYears}
          onChange={v => set({ refi: { ...inputs.refi, termYears: Math.max(1, Math.round(v)) } })} />

        <NumberField label="Closing Costs ($)" value={inputs.refi.closingCosts}
          onChange={v => set({ refi: { ...inputs.refi, closingCosts: v } })} prefix="$" />

        <ToggleField label="Pay minimum only (15yr scenario)"
          checked={inputs.refi.useMinimumPayment}
          onChange={v => set({ refi: { ...inputs.refi, useMinimumPayment: v } })} />

        {!inputs.refi.useMinimumPayment && (
          <SliderField label="Refi Target Payment"
            value={inputs.refi.targetMonthlyPayment}
            min={3000} max={10000} step={50}
            format={v => formatCurrency(v)}
            onChange={v => set({ refi: { ...inputs.refi, targetMonthlyPayment: v } })} />
        )}
      </Section>

      {/* ── 2-1 Buydown ───────────────────────────────────────── */}
      <Section id="buydown" label="2-1 Buydown" open={open.buydown} onToggle={() => toggle('buydown')}>
        <ToggleField label="Show buydown scenarios"
          checked={inputs.buydown.enabled}
          onChange={v => set({ buydown: { ...inputs.buydown, enabled: v } })} />

        {inputs.buydown.enabled && (
          <>
            <SliderField label="Note Rate (full fixed rate)"
              value={inputs.buydown.noteRate}
              min={0.03} max={0.10} step={0.00125}
              format={formatRate}
              onChange={v => set({ buydown: { ...inputs.buydown, noteRate: v } })} />

            <ToggleField label="Auto Year 1/2 rates (note-2%, note-1%)"
              checked={inputs.buydown.useAutoRates}
              onChange={v => set({ buydown: { ...inputs.buydown, useAutoRates: v } })} />

            {!inputs.buydown.useAutoRates && (
              <>
                <SliderField label="Year 1 Rate"
                  value={inputs.buydown.year1Rate}
                  min={0.01} max={0.10} step={0.00125}
                  format={formatRate}
                  onChange={v => set({ buydown: { ...inputs.buydown, year1Rate: v } })} />
                <SliderField label="Year 2 Rate"
                  value={inputs.buydown.year2Rate}
                  min={0.01} max={0.10} step={0.00125}
                  format={formatRate}
                  onChange={v => set({ buydown: { ...inputs.buydown, year2Rate: v } })} />
              </>
            )}

            {inputs.buydown.useAutoRates && (
              <div className="read-only-value" style={{ fontSize: 11 }}>
                Yr1: {formatRate(inputs.buydown.noteRate - 0.02)} · Yr2: {formatRate(inputs.buydown.noteRate - 0.01)}
              </div>
            )}

            <NumberField label="Term (years)" value={inputs.buydown.termYears}
              onChange={v => set({ buydown: { ...inputs.buydown, termYears: Math.max(1, Math.round(v)) } })} />

            <ToggleField label="Use same year periods as ARM"
              checked={inputs.buydown.useSamePeriodsAsARM}
              onChange={v => set({ buydown: { ...inputs.buydown, useSamePeriodsAsARM: v } })} />

            <div className="field">
              <span className="field__label">Subsidy Source</span>
              <select value={inputs.buydown.subsidySource}
                onChange={e => set({ buydown: { ...inputs.buydown, subsidySource: e.target.value as 'lender' | 'seller' | 'builder' | 'other' } })}>
                <option value="lender">Lender</option>
                <option value="seller">Seller</option>
                <option value="builder">Builder</option>
                <option value="other">Other</option>
              </select>
            </div>
          </>
        )}
      </Section>

      {/* ── Investment Projection ──────────────────────────────── */}
      <Section id="investment" label="Investment Projection" open={open.investment} onToggle={() => toggle('investment')}>
        <SliderField label="Annual Return"
          value={inputs.annualInvestmentReturn}
          min={0.05} max={0.25} step={0.005}
          format={formatRate}
          onChange={v => set({ annualInvestmentReturn: v })} />
      </Section>

      <button className="reset-btn" onClick={() => onChange(DEFAULT_INPUTS)}>
        Reset to Defaults
      </button>
    </div>
  );
}
