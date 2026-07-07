"use client";

import { useEffect, useState } from "react";

const FB_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

function loadFacebookSdk(appId) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Facebook SDK can only load in the browser"));
      return;
    }

    if (window.FB) {
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = function fbAsyncInit() {
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: "v25.0",
      });
      resolve(window.FB);
    };

    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.FB));
      existing.addEventListener("error", () => reject(new Error("Failed to load Facebook SDK")));
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = FB_SDK_URL;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.body.appendChild(script);
  });
}

export default function ConnectPage() {
  const [status, setStatus] = useState("Loading Meta SDK...");
  const [sdkReady, setSdkReady] = useState(false);
  const [signupInfo, setSignupInfo] = useState(null);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;

  useEffect(() => {
    function handleMessage(event) {
      if (!event.origin.endsWith("facebook.com")) return;

      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;

      const data = payload?.data || payload?.event || payload;
      const wabaId = data?.waba_id || data?.wabaId || null;
      const phoneNumberId = data?.phone_number_id || data?.phoneNumberId || null;

      if (wabaId || phoneNumberId) {
        setSignupInfo({ wabaId, phoneNumberId });
        setStatus("Embedded signup details received.");
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!appId) {
      setStatus("Missing NEXT_PUBLIC_META_APP_ID.");
      return;
    }

    loadFacebookSdk(appId)
      .then(() => {
        setSdkReady(true);
        setStatus("Meta SDK ready.");
      })
      .catch((error) => {
        setStatus(error.message);
      });
  }, [appId]);

  async function handleConnect() {
    if (!window.FB) {
      setStatus("Facebook SDK not ready.");
      return;
    }

    if (!configId) {
      setStatus("Missing NEXT_PUBLIC_META_CONFIG_ID. Add it after Meta verification.");
      return;
    }

    setStatus("Opening WhatsApp embedded signup...");

    window.FB.login(
      (response) => {
        void (async () => {
          const code = response?.authResponse?.code;
          if (!code) {
            setStatus("Signup cancelled or no auth code returned.");
            return;
          }

          setStatus("Exchanging code...");

          try {
            const exchangeResponse = await fetch("/api/meta/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code,
                waba_id: signupInfo?.wabaId || null,
                phone_number_id: signupInfo?.phoneNumberId || null,
              }),
            });

            const exchangePayload = await exchangeResponse.json();
            if (!exchangeResponse.ok || !exchangePayload.ok) {
              setStatus("Token exchange failed.");
              return;
            }

            setStatus("WhatsApp connected successfully.");
          } catch {
            setStatus("Token exchange request failed.");
          }
        })();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: "3",
        },
      }
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: "640px" }}>
      <h1>Connect WhatsApp</h1>
      <p>{status}</p>
      {signupInfo ? (
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(signupInfo, null, 2)}
        </pre>
      ) : null}
      <button type="button" onClick={handleConnect} disabled={!sdkReady}>
        Connect WhatsApp
      </button>
    </main>
  );
}
