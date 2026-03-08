export const COMING_SOON = "COMING SOON.";

export function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

export function displayValue(value, fallback = COMING_SOON) {
  return hasValue(value) ? value : fallback;
}
