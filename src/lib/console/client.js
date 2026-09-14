// Browser-side helpers shared by the Copilot console screens.

// An expired session is not an error the screen should render — the browser is
// already on its way to the login page, so the caller's promise never settles.
const NAVIGATING = new Promise(() => {});

export function consoleBase(tenant) {
  return `/copilot/${encodeURIComponent(tenant)}`;
}

export async function consoleJson(
  base,
  url,
  { fallback = "Something went wrong.", ...init } = {}
) {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = `/copilot?next=${encodeURIComponent(base)}`;
    return NAVIGATING;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallback);
  return body;
}
