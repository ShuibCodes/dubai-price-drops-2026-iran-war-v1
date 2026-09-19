const NAVIGATING = new Promise(() => {});

export async function internalJson(url, { fallback = "Something went wrong.", ...init } = {}) {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = "/internal/login";
    return NAVIGATING;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallback);
  return body;
}
