let lastTimestampMs = 0;

export function now() {
  const current = Date.now();
  lastTimestampMs = Math.max(current, lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function resetTimestampClockForTests() {
  lastTimestampMs = 0;
}
