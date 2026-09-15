/**
 * Console call recording proxy — no live Vapi HTTP unless injected.
 *
 * node ./scripts/qa-call-recording.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);

const {
  callHasPlayableRecording,
  extractVapiRecordingUrl,
  fetchRecordingMedia,
  fetchVapiCallRecord,
  recordingAccess,
  recordingPlayback,
  resolveCallRecording,
} = await import("../src/lib/vapi/recording.js");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail || ""}`);
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CALL_A = {
  id: "call-a",
  tenant_id: TENANT_A,
  vapi_call_id: "vapi-a",
  recording_url: "https://media.example/expired-a.wav",
};
const SESSION_A = { agentId: "agent-a", tenantId: TENANT_A, role: "agent" };
const SESSION_B = { agentId: "agent-b", tenantId: TENANT_B, role: "agent" };

console.log("\nAUTH");
check("anonymous is rejected", recordingAccess(null, CALL_A).status === 401);
check(
  "authenticated owner is allowed",
  recordingAccess(SESSION_A, CALL_A).ok === true
);

console.log("\nTENANT ISOLATION");
check(
  "own tenant call is allowed",
  recordingAccess(SESSION_A, CALL_A).ok === true
);
check(
  "other tenant call is 404, not 200",
  recordingAccess(SESSION_B, CALL_A).status === 404 &&
    recordingAccess(SESSION_B, CALL_A).ok === false
);

console.log("\nCALL / RECORDING STATE");
check("missing call is 404", recordingAccess(SESSION_A, null).status === 404);
check(
  "empty recording_url is not playable",
  callHasPlayableRecording({ recording_url: "", vapi_call_id: "vapi-a" }) === false
);
check(
  "malformed recording metadata is not playable",
  callHasPlayableRecording({
    recording_url: "customer-busy",
    vapi_call_id: "vapi-a",
  }) === false &&
    callHasPlayableRecording({ recording_url: "not-a-url", vapi_call_id: "vapi-a" }) ===
      false
);
check(
  "https recording without vapi_call_id is not playable",
  callHasPlayableRecording({ recording_url: "https://cdn.example/ok.mp3" }) === false
);
check(
  "https recording with vapi_call_id is playable",
  callHasPlayableRecording({
    recording_url: "https://cdn.example/ok.mp3",
    vapi_call_id: "vapi-a",
  }) === true
);

console.log("\nUI");
{
  const play = recordingPlayback({
    id: "call-a",
    has_recording: true,
  });
  check(
    "valid recording uses internal proxy path",
    play.kind === "play" &&
      play.href === "/api/console/calls/call-a/recording" &&
      !String(play.href).includes("cdn.example")
  );
  const missing = recordingPlayback({
    id: "call-busy",
    status: "completed",
    recording_url: "",
  });
  check("no recording shows missing control", missing.kind === "missing");
  const malformed = recordingPlayback({
    id: "call-bad",
    status: "completed",
    recording_url: "twilio-failed-to-connect-call",
  });
  check(
    "malformed stored URL is not an external link",
    malformed.kind === "missing" && !malformed.href
  );
  const queued = recordingPlayback({ id: "q1", status: "queued" });
  check("queued row does not show a broken play link", queued.kind === "none");
}

console.log("\nVAPI PAYLOAD + FAILURES");
check(
  "extracts recordingUrl from call payload",
  extractVapiRecordingUrl({
    recordingUrl: "https://vapi-cdn.example/fresh.wav",
  }) === "https://vapi-cdn.example/fresh.wav"
);
check(
  "does not treat non-http recording fields as URLs",
  extractVapiRecordingUrl({ recordingUrl: "customer-did-not-answer" }) === ""
);

{
  const expired = await fetchVapiCallRecord("vapi-missing", {
    apiKey: "test-key",
    fetchImpl: async () => new Response("{}", { status: 404 }),
  });
  check("Vapi 404 is a safe not-found", expired.status === 404 && expired.ok === false);

  const authFail = await fetchVapiCallRecord("vapi-a", {
    apiKey: "test-key",
    fetchImpl: async () => new Response("{}", { status: 401 }),
  });
  check(
    "Vapi auth failure is a safe 502",
    authFail.status === 502 && !JSON.stringify(authFail).includes("test-key")
  );

  const netFail = await fetchVapiCallRecord("vapi-a", {
    apiKey: "test-key",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  check("Vapi network failure is a safe 502", netFail.status === 502);

  const fresh = await fetchVapiCallRecord("vapi-a", {
    apiKey: "test-key",
    fetchImpl: async (url, init) => {
      check(
        "Vapi GET uses existing /call collection + id",
        String(url).endsWith("/call/vapi-a")
      );
      check(
        "Vapi Authorization stays on the server fetch",
        String(init.headers.Authorization).startsWith("Bearer ")
      );
      return Response.json({
        recordingUrl: "https://vapi-cdn.example/fresh.wav",
      });
    },
  });
  check("valid Vapi call yields an https recording URL", fresh.ok && fresh.recordingUrl.startsWith("https://"));
}

{
  const resolved = await resolveCallRecording(CALL_A, {
    apiKey: "secret-key-do-not-leak",
    fetchImpl: async () =>
      Response.json({ recordingUrl: "https://vapi-cdn.example/fresh.wav" }),
  });
  check(
    "resolves a fresh URL instead of returning the stored dead URL to the client helper",
    resolved.ok && resolved.recordingUrl === "https://vapi-cdn.example/fresh.wav"
  );

  const noFallback = await resolveCallRecording(CALL_A, {
    apiKey: "secret-key-do-not-leak",
    fetchImpl: async () => new Response("{}", { status: 404 }),
  });
  check(
    "Vapi 404 does not fall back to the stored recording_url",
    noFallback.ok === false &&
      noFallback.status === 404 &&
      noFallback.recordingUrl !== CALL_A.recording_url
  );

  const media = await fetchRecordingMedia("https://vapi-cdn.example/fresh.wav", {
    fetchImpl: async (url) => {
      check("audio fetch uses the Vapi media URL server-side", url.includes("vapi-cdn.example"));
      return new Response("ID3", {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Content-Length": "3" },
      });
    },
  });
  check("valid recording returns audio content-type", media.ok && media.headers["Content-Type"] === "audio/mpeg");
}

{
  const dumped = JSON.stringify({
    access: recordingAccess(SESSION_A, CALL_A),
    playback: recordingPlayback({
      id: CALL_A.id,
      recording_url: CALL_A.recording_url,
      vapi_call_id: CALL_A.vapi_call_id,
    }),
  });
  check("Vapi API key is never present in client-facing helper output", !dumped.includes("VAPI"));
  check(
    "raw stored Vapi URL is not used as the play href",
    recordingPlayback({
      id: CALL_A.id,
      recording_url: CALL_A.recording_url,
      vapi_call_id: CALL_A.vapi_call_id,
    }).href === "/api/console/calls/call-a/recording"
  );
}

console.log("\nRUNS API SELECT");
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const runsRoute = readFileSync(
    join(root, "src/app/api/console/runs/[id]/route.js"),
    "utf8"
  );
  const select = runsRoute.match(/from\("calls"\)[\s\S]*?\.select\(\s*"([^"]+)"/);
  const columns = select?.[1] || "";
  check(
    "runs call select includes vapi_call_id for has_recording",
    columns.includes("vapi_call_id") && columns.includes("recording_url")
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;
