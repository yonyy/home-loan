import { useState } from 'react';
import type { ScenarioResult, LoanInputs } from '../types/loan.types';
import { scheduleToCSV, downloadCSV, scenarioSummaryToJSON } from '../logic/exportUtils';

interface Props {
  scenario: ScenarioResult;
  inputs: LoanInputs;
}

export function ExportButton({ scenario, inputs }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCSV = () => {
    const csv = scheduleToCSV(scenario.schedule, inputs.loanStartMonth, inputs.loanStartYear, inputs.originalPrincipal);
    const safeName = scenario.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadCSV(`${safeName}_schedule.csv`, csv);
  };

  const handleCopyJSON = async () => {
    const json = scenarioSummaryToJSON(scenario);
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={handleCSV} style={{
        padding: '5px 12px',
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-muted)',
        fontSize: 12,
        cursor: 'pointer',
      }}>
        ↓ CSV
      </button>
      <button onClick={handleCopyJSON} style={{
        padding: '5px 12px',
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: copied ? 'var(--color-accent-green)' : 'var(--color-text-muted)',
        fontSize: 12,
        cursor: 'pointer',
      }}>
        {copied ? '✓ Copied' : '{ } JSON'}
      </button>
    </div>
  );
}
