// In-memory pub/sub for attendance events delivered over SSE.
// SINGLE-INSTANCE ONLY: events reach only clients connected to the same Node
// process that published them. A multi-instance deployment needs a shared
// broker (e.g. Redis pub/sub) instead.
const clients = new Set();

/**
 * Register a connected SSE client.
 * @param {{ res: { write: (frame: string) => void }, user: object }} client
 * @returns {() => void} unsubscribe function
 */
export function subscribeAttendance({ res, user }) {
  const client = { res, user };
  clients.add(client);
  return () => {
    clients.delete(client);
  };
}

/**
 * Broadcast an attendance event to every connected SSE client.
 * @param {object} event { type, userId, name, date, clockIn, clockOut, hoursWorked, status, autoLoggedOut }
 */
export function publishAttendance(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch (e) {
      // A slow/closed client must never break the publisher or the request.
    }
  }
}
