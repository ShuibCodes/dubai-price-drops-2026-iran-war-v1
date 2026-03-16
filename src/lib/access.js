export const ACCESS_STORAGE_KEY = "dubai-real-estate-ai-access";
export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

export function getStoredAccess() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(ACCESS_STORAGE_KEY);
  return rawValue ? safeJsonParse(rawValue) : null;
}

export function saveStoredAccess(access) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(access));
}

export function startTrialAccess(email, company = {}) {
  const existingAccess = getStoredAccess() ?? {};
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const companyName = company?.name?.trim() ?? existingAccess.companyName ?? "";
  const companySlug = company?.slug?.trim() ?? existingAccess.companySlug ?? "";
  const nextAccess = {
    ...existingAccess,
    email: normalizedEmail,
    companyName,
    companySlug,
    trialStartedAt: existingAccess.trialStartedAt ?? new Date().toISOString(),
  };

  saveStoredAccess(nextAccess);
  return nextAccess;
}

export function markLifetimeAccess(email) {
  const existingAccess = getStoredAccess() ?? {};
  const nextAccess = {
    ...existingAccess,
    email: email ?? existingAccess.email ?? null,
    hasLifetimeAccess: true,
    lifetimeUnlockedAt: new Date().toISOString(),
  };

  saveStoredAccess(nextAccess);
  return nextAccess;
}

export function getTrialStatus(access = getStoredAccess()) {
  if (!access?.trialStartedAt) {
    return {
      isActive: false,
      trialEndsAt: null,
    };
  }

  const trialEndsAt = new Date(
    new Date(access.trialStartedAt).getTime() + TRIAL_DURATION_MS
  );

  return {
    isActive: trialEndsAt.getTime() > Date.now(),
    trialEndsAt: trialEndsAt.toISOString(),
  };
}
