// Session lifecycle, modeled on the RUM SDK's own session behavior: UUID v4,
// 4h total / 15m inactivity timeout, new session on login/logout (n/a here),
// and session.start/session.end log events. Whether Datadog's ingestion
// enforces matching expiry rules on the OTLP side is untested — see NOTES.md.

const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

let sessionId = null;
let sessionStart = 0;
let lastActivity = 0;
let onSessionStart = null;
let onSessionEnd = null;

function newSessionId() {
  return crypto.randomUUID();
}

export function initSession({ onStart, onEnd } = {}) {
  onSessionStart = onStart ?? null;
  onSessionEnd = onEnd ?? null;
}

export function getSessionId() {
  const now = Date.now();
  const expired =
    !sessionId ||
    now - sessionStart > SESSION_TIMEOUT_MS ||
    now - lastActivity > INACTIVITY_TIMEOUT_MS;

  if (expired) {
    if (sessionId && onSessionEnd) onSessionEnd(sessionId);
    sessionId = newSessionId();
    sessionStart = now;
    if (onSessionStart) onSessionStart(sessionId);
  }

  lastActivity = now;
  return sessionId;
}

export function endSession() {
  if (sessionId && onSessionEnd) onSessionEnd(sessionId);
  sessionId = null;
}
