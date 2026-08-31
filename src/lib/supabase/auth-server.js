import { createServerClient } from "@supabase/ssr";

// Sibling to server.js: that one is service-role and bypasses RLS, this one is
// the anon key and only ever carries the signed-in user's own session.
const COOKIE_DEFAULTS = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

// Next.js patches global fetch and stores responses in its Data Cache — which
// must never hold auth tokens or PostgREST results. Opt out on every request.
const NO_STORE = {
  fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
};

/**
 * @supabase/ssr passes httpOnly: false with every write because its *browser*
 * client reads document.cookie. This app has no browser Supabase client, so the
 * flag is forced back on after the spread — the sb-* cookies hold the access
 * and refresh tokens and must stay out of reach of page JavaScript. Deletions
 * (maxAge: 0) and the library's path/sameSite/expiry pass through untouched.
 */
function hardenedCookieOptions(options) {
  return { ...COOKIE_DEFAULTS, ...options, httpOnly: true };
}

export function isSupabaseAuthConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function credentials() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase Auth is not configured");
  return { url, key };
}

/** NextRequest cookies and next/headers cookies() both expose getAll(). */
function readableCookies(source) {
  if (!source) return null;
  if (typeof source.cookies?.getAll === "function") return source.cookies;
  if (typeof source.getAll === "function") return source;
  return null;
}

/**
 * Route handlers: collect Supabase's cookie writes and apply them to whichever
 * response the handler ends up returning, including redirects.
 * @returns {{ supabase: object, applyTo: (response: object) => object }}
 */
export function createRouteAuthClient(request) {
  const { url, key } = credentials();
  const store = readableCookies(request);
  const pending = [];

  const supabase = createServerClient(url, key, {
    global: NO_STORE,
    cookies: {
      getAll: () => store?.getAll() ?? [],
      setAll: (list) => pending.push(...list),
    },
  });

  return {
    supabase,
    applyTo(response) {
      for (const { name, value, options } of pending) {
        response.cookies.set(name, value, hardenedCookieOptions(options));
      }
      return response;
    },
  };
}

/**
 * Server Components and getSession(): reads only. A Server Component cannot set
 * cookies, so token refresh is middleware's job and writes are dropped here.
 */
export function createReadOnlyAuthClient(source) {
  const { url, key } = credentials();
  const store = readableCookies(source);

  return createServerClient(url, key, {
    global: NO_STORE,
    cookies: {
      getAll: () => store?.getAll() ?? [],
      setAll: () => {},
    },
  });
}

/**
 * Middleware: refreshed tokens must reach both the browser (response cookies)
 * and the rest of this request (request cookies), so the response is rebuilt
 * whenever Supabase rotates them. Callers must return holder.response.
 */
export function createMiddlewareAuthClient(request, NextResponse) {
  const { url, key } = credentials();
  const holder = { response: NextResponse.next({ request }) };

  const supabase = createServerClient(url, key, {
    global: NO_STORE,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) {
          request.cookies.set(name, value);
        }
        holder.response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          holder.response.cookies.set(name, value, hardenedCookieOptions(options));
        }
      },
    },
  });

  return { supabase, holder };
}

/** Copy rotated auth cookies onto a redirect/error response. */
export function carryAuthCookies(from, to) {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
