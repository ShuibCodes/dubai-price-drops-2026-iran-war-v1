"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Strip } from "@/components/ui/strip";
import { loadFacebookSdk } from "@/lib/meta/facebook-sdk";

export function WhatsAppConnect({ tenantSlug, onConnected }) {
  const [status, setStatus] = useState("Loading Meta…");
  const [sdkReady, setSdkReady] = useState(false);
  const signupInfoRef = useRef(null);
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
        signupInfoRef.current = { wabaId, phoneNumberId };
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!appId) {
      setStatus("Missing Meta app id.");
      return;
    }
    loadFacebookSdk(appId)
      .then(() => {
        setSdkReady(true);
        setStatus("");
      })
      .catch((error) => setStatus(error.message));
  }, [appId]);

  async function handleConnect() {
    if (!window.FB) {
      setStatus("Facebook SDK not ready.");
      return;
    }
    if (!configId) {
      setStatus("Missing Meta config id.");
      return;
    }
    signupInfoRef.current = null;
    setStatus("Opening Meta’s WhatsApp signup…");
    window.FB.login(
      (response) => {
        void (async () => {
          const code = response?.authResponse?.code;
          if (!code) {
            setStatus("Signup cancelled.");
            return;
          }
          setStatus("Saving the connection…");
          try {
            const exchangeResponse = await fetch("/api/meta/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code,
                waba_id: signupInfoRef.current?.wabaId || null,
                phone_number_id: signupInfoRef.current?.phoneNumberId || null,
                tenant_slug: tenantSlug,
              }),
            });
            const payload = await exchangeResponse.json();
            if (!exchangeResponse.ok || !payload.ok) {
              setStatus(payload?.error || "Connection failed.");
              return;
            }
            if (!payload.subscribed) {
              setStatus(
                `Connected, but webhook subscription failed: ${payload.subscribe_error || "unknown"}`
              );
              return;
            }
            setStatus("");
            onConnected?.(payload);
          } catch {
            setStatus("Token exchange failed.");
          }
        })();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink-2">
        AgentZero sits on the same business number that is already on your phone.
        Leads keep texting you. After this connects, you text AgentZero from
        this phone only — not someone else&apos;s line. Nobody else who messages
        AgentZero can see your chats.
      </p>
      <p className="text-sm leading-6 text-ink-2">
        AgentZero is an official Meta tech provider. Connecting uses Meta
        Embedded Signup — Meta issues the WhatsApp Business Account and tokens.
        Messages and number metadata go through Meta’s Cloud API. The app is
        verified through Meta; you are granting AgentZero access to this number
        via Meta, not handing a login to a random form.
      </p>
      <p className="text-sm leading-6 text-ink-3">
        Meta’s terms apply to that path. You can disconnect later in Settings.{" "}
        <a className="underline underline-offset-2" href="/privacy">
          Privacy policy
        </a>
        .
      </p>
      {status ? (
        <Strip tone="warn">
          <span>{status}</span>
        </Strip>
      ) : null}
      <Button disabled={!sdkReady} onClick={handleConnect}>
        Connect WhatsApp
      </Button>
    </div>
  );
}
