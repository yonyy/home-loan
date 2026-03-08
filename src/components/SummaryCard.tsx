interface SummaryCardProps {
  label: string;
  value: string;
  sub?: string;
}

export function SummaryCard({ label, value, sub }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <span className="summary-card__label">{label}</span>
      <span className="summary-card__value">{value}</span>
      {sub && <span className="summary-card__sub">{sub}</span>}
    </div>
  );
}
