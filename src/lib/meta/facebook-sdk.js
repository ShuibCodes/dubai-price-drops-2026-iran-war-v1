const FB_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_VERSION = "v25.0";
const READY_TIMEOUT_MS = 15000;

let sdkPromise = null;

function ensureInit(appId) {
  if (typeof window === "undefined" || !window.FB?.init || window.__azFbInited) {
    return;
  }
  window.FB.init({
    appId,
    cookie: true,
    xfbml: false,
    version: GRAPH_VERSION,
  });
  window.__azFbInited = true;
}

function isSdkReady() {
  return typeof window !== "undefined" && typeof window.FB?.init === "function";
}

/**
 * Load Meta's JS SDK once per page. Safe to call after remounts: if the
 * script tag already finished, we do not wait for a load event that will
 * never fire again.
 */
export function loadFacebookSdk(appId) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Facebook SDK can only load in the browser"));
  }
  if (!appId) {
    return Promise.reject(new Error("Missing Meta app id."));
  }
  if (isSdkReady()) {
    ensureInit(appId);
    return Promise.resolve(window.FB);
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    let settled = false;
    let pollId = 0;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollId);
      if (error) {
        sdkPromise = null;
        reject(error);
        return;
      }
      resolve(window.FB);
    };

    const tryReady = () => {
      if (!isSdkReady()) return false;
      try {
        ensureInit(appId);
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Facebook SDK init failed"));
      }
      return true;
    };

    if (tryReady()) return;

    window.fbAsyncInit = function fbAsyncInit() {
      tryReady();
    };

    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = FB_SDK_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => finish(new Error("Failed to load Facebook SDK"));
      document.body.appendChild(script);
    }

    const started = Date.now();
    pollId = window.setInterval(() => {
      if (tryReady()) return;
      if (Date.now() - started > READY_TIMEOUT_MS) {
        finish(new Error("Meta SDK timed out. Refresh and try again."));
      }
    }, 50);
  });

  return sdkPromise;
}
