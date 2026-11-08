import assert from "node:assert/strict";
import {
  addMinutesIso,
  expandBusyWithBuffer,
  isWithinViewingWindow,
  resolveBookingWindow,
  slotOverlapsBusy,
  viewingWindowAllows,
} from "../src/lib/calendar/window.js";
import { DEFAULT_APPOINTMENT_BUFFER_MINUTES } from "../src/lib/calendar/schema.js";

function test(name, fn) {
  fn();
  console.log(`ok  ${name}`);
}

test("addMinutesIso preserves +04:00 instead of converting to Z", () => {
  assert.equal(
    addMinutesIso("2026-09-21T10:00:00+04:00", 30),
    "2026-09-21T10:30:00+04:00"
  );
  assert.equal(
    addMinutesIso("2026-09-21T10:00:00+04:00", 45),
    "2026-09-21T10:45:00+04:00"
  );
});

test("addMinutesIso UTC stays ISO Z", () => {
  assert.equal(
    addMinutesIso("2026-09-21T06:00:00.000Z", 30),
    "2026-09-21T06:30:00.000Z"
  );
});

test("default duration uses the stored calendar timezone", () => {
  const window = resolveBookingWindow(
    { startDateTime: "2026-09-21T10:00:00+04:00", timeZone: "Europe/London" },
    { calendar_timezone: "Asia/Dubai" }
  );
  assert.equal(window.endDateTime, "2026-09-21T10:30:00+04:00");
  assert.equal(window.timeZone, "Asia/Dubai");
  assert.equal(window.durationMinutes, 30);
});

test("15-minute buffer expands busy edges", () => {
  assert.equal(DEFAULT_APPOINTMENT_BUFFER_MINUTES, 15);
  const buffered = expandBusyWithBuffer([
    { start: "2026-09-21T10:35:00+04:00", end: "2026-09-21T11:00:00+04:00" },
  ]);
  assert.equal(
    slotOverlapsBusy("2026-09-21T10:00:00+04:00", "2026-09-21T10:30:00+04:00", [
      { start: "2026-09-21T10:35:00+04:00", end: "2026-09-21T11:00:00+04:00" },
    ]),
    false
  );
  assert.equal(
    slotOverlapsBusy(
      "2026-09-21T10:00:00+04:00",
      "2026-09-21T10:30:00+04:00",
      buffered
    ),
    true
  );
});

test("viewing window is Sun-Thu 10:00-18:00 in the calendar timezone", () => {
  assert.equal(isWithinViewingWindow("2026-09-21T10:00:00+04:00", "Asia/Dubai"), true);
  assert.equal(isWithinViewingWindow("2026-09-20T17:30:00+04:00", "Asia/Dubai"), true);
  assert.equal(isWithinViewingWindow("2026-09-25T10:00:00+04:00", "Asia/Dubai"), false);
  assert.equal(isWithinViewingWindow("2026-09-21T09:00:00+04:00", "Asia/Dubai"), false);
  assert.equal(isWithinViewingWindow("2026-09-21T18:00:00+04:00", "Asia/Dubai"), false);
  assert.equal(
    viewingWindowAllows({
      startDateTime: "2026-09-21T10:00:00+04:00",
      endDateTime: "2026-09-21T10:30:00+04:00",
      timeZone: "Asia/Dubai",
    }),
    true
  );
  assert.equal(
    viewingWindowAllows({
      startDateTime: "2026-09-21T17:45:00+04:00",
      endDateTime: "2026-09-21T18:15:00+04:00",
      timeZone: "Asia/Dubai",
    }),
    false
  );
});

console.log("\nAll calendar window tests passed.");
