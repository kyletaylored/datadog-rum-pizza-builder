// Session lifecycle, modeled on the RUM SDK's own session behavior: UUID v4,
// 4h total / 15m inactivity timeout, new session on login/logout (n/a here),
// and session.start/session.end log events. Whether Datadog's ingestion
// enforces matching expiry rules on the OTLP side is untested — see NOTES.md.
//
// getSessionId() is the SessionProvider the browser SDK's session processors
// call on every log record and span (src/main.js), so any event counts as
// activity. Used instead of the SDK's own createSessionManager() because that
// one can't be ended on demand (the wizard's "Start over" does).

const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

let sessionId = null;
let sessionStart = 0;
let lastActivity = 0;
let onSessionStart = null;
let onSessionEnd = null;
// The start/end callbacks emit log records, and the session processor calls
// getSessionId() for each one. Without this guard that call would see the
// session still expired and rotate it again, forever.
let rotating = false;

function newSessionId() {
  return crypto.randomUUID();
}

export function initSession({ onStart, onEnd } = {}) {
  onSessionStart = onStart ?? null;
  onSessionEnd = onEnd ?? null;
}

export function getSessionId() {
  if (rotating) return sessionId;
  const now = Date.now();
  const expired =
    !sessionId ||
    now - sessionStart > SESSION_TIMEOUT_MS ||
    now - lastActivity > INACTIVITY_TIMEOUT_MS;

  if (expired) {
    rotating = true;
    try {
      if (sessionId && onSessionEnd) onSessionEnd(sessionId);
      sessionId = newSessionId();
      sessionStart = now;
      if (onSessionStart) onSessionStart(sessionId);
    } finally {
      rotating = false;
    }
  }

  lastActivity = now;
  return sessionId;
}

export function endSession() {
  rotating = true;
  try {
    if (sessionId && onSessionEnd) onSessionEnd(sessionId);
  } finally {
    rotating = false;
  }
  sessionId = null;
}
