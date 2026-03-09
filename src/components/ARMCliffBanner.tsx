interface ARMCliffBannerProps {
  monthsToYear2: number;
  monthsToYear3: number;
  year1Rate: number;
  year2Rate: number;
  year3Rate: number;
  balance: number;
  onScrollToChart?: () => void;
}

function fmt$(v: number) {
  return "$" + Math.round(Math.abs(v)).toLocaleString();
}

function fmtRate(r: number) {
  return (r * 100).toFixed(3) + "%";
}

export function ARMCliffBanner({
  monthsToYear2,
  monthsToYear3,
  year1Rate,
  year2Rate,
  year3Rate,
  balance,
  onScrollToChart,
}: ARMCliffBannerProps) {
  // Determine which step-up is next and how far away it is
  let monthsAway: number;
  let fromRate: number;
  let toRate: number;
  let isPermanent = false;

  if (monthsToYear2 > 0) {
    // Still in year-1 period
    monthsAway = monthsToYear2;
    fromRate = year1Rate;
    toRate = year2Rate;
  } else if (monthsToYear3 > 0) {
    // In year-2 period, permanent rate approaching
    monthsAway = monthsToYear3;
    fromRate = year2Rate;
    toRate = year3Rate;
  } else {
    // At permanent rate — no banner needed
    isPermanent = true;
    fromRate = year3Rate;
    toRate = year3Rate;
    monthsAway = 0;
  }

  if (isPermanent) return null;

  // Dollar impact of the coming rate change
  const deltaMonthly = ((toRate - fromRate) / 12) * balance;
  const isNextPermanent = monthsToYear2 <= 0; // true when next step is the permanent rate

  const urgency = monthsAway <= 3 ? "high" : monthsAway <= 6 ? "med" : "low";

  const bgColor = urgency === "high"
    ? "rgba(239, 68, 68, 0.12)"
    : urgency === "med"
    ? "rgba(249, 115, 22, 0.10)"
    : "rgba(234, 179, 8, 0.08)";

  const borderColor = urgency === "high"
    ? "rgba(239, 68, 68, 0.35)"
    : urgency === "med"
    ? "rgba(249, 115, 22, 0.30)"
    : "rgba(234, 179, 8, 0.25)";

  const accentColor = urgency === "high" ? "#ef4444" : urgency === "med" ? "#f97316" : "#eab308";

  const monthLabel = monthsAway === 1 ? "1 month" : `${monthsAway} months`;

  return (
    <button
      onClick={onScrollToChart}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        width: "100%",
        padding: "10px 28px",
        background: bgColor,
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        borderBottom: `1px solid ${borderColor}`,
        borderTopWidth: 0,
        cursor: onScrollToChart ? "pointer" : "default",
        textAlign: "left",
        fontFamily: "inherit",
        flexWrap: "wrap",
        rowGap: 6,
      }}
    >
      {/* Left: clock + message */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>⏱</span>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>
            Rate {isNextPermanent ? "locks at permanent" : "steps"} {fmtRate(fromRate)} → {fmtRate(toRate)}
          </span>
          <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>
            in <strong style={{ color: "#e8e8e8" }}>{monthLabel}</strong>
            {isNextPermanent && <span style={{ marginLeft: 6, color: "#555", fontSize: 11 }}>(permanent rate)</span>}
          </span>
        </div>
      </div>

      {/* Right: impact pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{
          background: "rgba(239,68,68,0.15)",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 20,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 700,
          color: "#ef4444",
          fontFamily: "monospace",
          whiteSpace: "nowrap",
        }}>
          +{fmt$(deltaMonthly)}/mo
        </div>
        {onScrollToChart && (
          <span style={{ fontSize: 10, color: "#555" }}>↓ see chart</span>
        )}
      </div>
    </button>
  );
}
