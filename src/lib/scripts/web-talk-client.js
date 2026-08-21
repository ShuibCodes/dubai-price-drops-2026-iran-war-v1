let DailyLib = null;
let activeCall = null;

async function loadDaily() {
  if (!DailyLib) {
    const mod = await import("@daily-co/daily-js");
    DailyLib = mod.default;
  }
  return DailyLib;
}

function destroyAudioPlayers() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll("audio[data-agentzero-web-talk]")
    .forEach((node) => node.remove());
}

async function playRemoteAudio(track, participantId) {
  const player = document.createElement("audio");
  player.dataset.agentzeroWebTalk = "1";
  player.dataset.participantId = participantId;
  player.autoplay = true;
  player.playsInline = true;
  player.srcObject = new MediaStream([track]);
  document.body.appendChild(player);
  try {
    await player.play();
  } catch (error) {
    player.remove();
    throw error;
  }
  return player;
}

async function destroyCall(call) {
  if (!call) return;
  try {
    const state = typeof call.meetingState === "function" ? call.meetingState() : "";
    if (state && state !== "left-meeting" && state !== "new") {
      await call.leave();
    }
  } catch {
    // already left
  }
  try {
    await call.destroy();
  } catch {
    // already destroyed
  }
  if (activeCall === call) activeCall = null;
  destroyAudioPlayers();
}

async function destroyExistingDaily() {
  const Daily = await loadDaily();
  const existing =
    activeCall ||
    (typeof Daily.getCallInstance === "function" && Daily.getCallInstance()) ||
    null;
  if (existing) await destroyCall(existing);
  activeCall = null;
}

/**
 * Warm the mic during the click (user gesture). Stop the warmup stream so
 * Daily can own the device; permission stays granted.
 */
export async function unlockMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot talk here.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  stream.getTracks().forEach((track) => track.stop());
}

export async function joinWebTalk({
  webCallUrl,
  callToken,
  onLocalLevel,
} = {}) {
  if (typeof window === "undefined") {
    throw new Error("Talk here only runs in the browser.");
  }
  if (!webCallUrl) throw new Error("Talk here did not return a join URL.");

  await destroyExistingDaily();

  const Daily = await loadDaily();
  const call = Daily.createCallObject({
    audioSource: true,
    videoSource: false,
  });
  call.iframe?.()?.style?.setProperty("display", "none");

  call.on("participant-joined", (event) => {
    if (!event?.participant || event.participant.local) return;
    call.updateParticipant(event.participant.session_id, {
      setSubscribedTracks: { audio: true, video: false },
    });
  });

  call.on("track-started", async (event) => {
    if (!event?.participant || event.participant.local) return;
    if (event.track?.kind !== "audio") return;
    try {
      await playRemoteAudio(event.track, event.participant.session_id);
      call.sendAppMessage("playable");
    } catch {
      // autoplay; click already happened so this should be rare
    }
  });

  call.on("participant-left", (event) => {
    const id = event?.participant?.session_id;
    if (!id) return;
    document
      .querySelectorAll(`audio[data-participant-id="${id}"]`)
      .forEach((node) => node.remove());
  });

  if (typeof onLocalLevel === "function") {
    call.on("local-audio-level", (event) => {
      onLocalLevel(Number(event?.audioLevel) || 0);
    });
  }

  try {
    await call.join({
      url: webCallUrl,
      ...(callToken ? { token: callToken } : {}),
      startAudioOff: false,
      startVideoOff: true,
      subscribeToTracksAutomatically: false,
    });
    await call.setLocalAudio(true);
    await call.setLocalVideo(false);
    try {
      call.startLocalAudioLevelObserver(100);
    } catch {
      // observer optional
    }
    call.sendAppMessage("playable");
  } catch (error) {
    await destroyCall(call);
    throw error;
  }

  activeCall = call;
  return { call };
}

export async function leaveWebTalk(session) {
  const call = session?.call;
  session?.stream?.getTracks?.().forEach((track) => track.stop());
  if (call) {
    await destroyCall(call);
    return;
  }
  try {
    await destroyExistingDaily();
  } catch {
    // no instance
  }
}
