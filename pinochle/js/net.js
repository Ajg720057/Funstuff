// Network transports. Both store the whole game as one JSON string per room,
// and every change is made inside a transaction so two phones can't clobber
// each other.
//
//   subscribe(code, cb)   -> unsubscribe fn; cb(state | null) on every change
//   transact(code, fn)    -> Promise<{ committed, state }>
//                            fn(current | null) returns the new state, or
//                            undefined to abort.

const FB_VERSION = '10.12.2';

export async function firebaseTransport(config) {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
  const db = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database.js`);
  const app = appMod.initializeApp(config);
  const database = db.getDatabase(app);
  const roomRef = (code) => db.ref(database, `pinochle/rooms/${code}`);
  const parse = (v) => (v && v.state ? JSON.parse(v.state) : null);

  return {
    online: true,
    subscribe(code, cb) {
      return db.onValue(roomRef(code), (snap) => cb(parse(snap.val())));
    },
    async transact(code, fn) {
      const res = await db.runTransaction(roomRef(code), (cur) => {
        const next = fn(parse(cur));
        // Firebase may first call this with an empty local cache. Returning
        // null (instead of aborting) makes it check the server and re-run us
        // with the real value.
        if (next === undefined) return cur == null ? null : undefined;
        return { state: JSON.stringify(next), updated: Date.now() };
      });
      const state = parse(res.snapshot.val());
      return { committed: res.committed && state != null, state };
    },
    async get(code) {
      return parse((await db.get(roomRef(code))).val());
    },
  };
}

// Test-mode transport: keeps the room in this browser's localStorage.
// Tabs in the same browser see each other's changes, so you can try the
// multiplayer flow with three tabs (add ?pid=1, ?pid=2, ?pid=3 to each).
export function localTransport() {
  const key = (code) => `pinochle-room-${code}`;
  const listeners = new Map();
  const read = (code) => {
    try {
      const raw = localStorage.getItem(key(code));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const emit = (code) => (listeners.get(code) || []).forEach((cb) => cb(read(code)));
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('pinochle-room-')) emit(e.key.slice('pinochle-room-'.length));
  });

  return {
    online: false,
    subscribe(code, cb) {
      if (!listeners.has(code)) listeners.set(code, []);
      listeners.get(code).push(cb);
      setTimeout(() => cb(read(code)), 0);
      return () => listeners.set(code, listeners.get(code).filter((x) => x !== cb));
    },
    async get(code) {
      return read(code);
    },
    async transact(code, fn) {
      const next = fn(read(code));
      if (next === undefined) return { committed: false, state: read(code) };
      localStorage.setItem(key(code), JSON.stringify(next));
      emit(code);
      return { committed: true, state: next };
    },
  };
}
