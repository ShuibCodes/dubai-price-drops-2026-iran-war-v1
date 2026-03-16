const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatCompactNumber(value) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }

  return `${Math.round(value)}`;
}

export function formatCurrency(value, { compact = false, withPeriod = false, period = "yearly" } = {}) {
  const amount = period === "monthly" ? value / 12 : value;
  const formatted = compact
    ? `AED ${formatCompactNumber(amount)}`
    : `AED ${numberFormatter.format(Math.round(amount))}`;

  if (!withPeriod) {
    return formatted;
  }

  return `${formatted}/${period === "monthly" ? "mo" : "yr"}`;
}

export function formatDropAmount(value, options = {}) {
  return `-${formatCurrency(value, options)}`;
}

export function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

export function formatSignedPercent(value) {
  return `-${formatPercent(value)}`;
}

export function formatGainAmount(value, options = {}) {
  return `+${formatCurrency(Math.abs(value), options)}`;
}

export function formatUnsignedPercent(value) {
  return formatPercent(Math.abs(value));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatAreaTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatMinutesAgo(minutes) {
  const safeMinutes = Math.max(1, minutes);
  return `Updated ${safeMinutes} min${safeMinutes === 1 ? "" : "s"} ago`;
}
