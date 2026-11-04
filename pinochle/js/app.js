import { apply, createGame, legalPlays, minNextBid, nameOf, seatOf, trickWinnerIndex, NUM_PLAYERS } from './engine.js';
import { computeMeld } from './meld.js';
import { rank, suit, isRed, RANK_LABEL, SUIT_SYMBOL, SUIT_NAME, sortHand } from './cards.js';
import { firebaseConfig } from './firebase-config.js';
import { firebaseTransport, localTransport } from './net.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Local storage helpers (never let a storage failure break the app)
// ---------------------------------------------------------------------------
const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

function randomId(n = 12) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) s += a[b % a.length];
  return s;
}
function roomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => a[b % a.length]).join('');
}

// Device player id. ?pid=xyz overrides it (handy for testing in several tabs).
const pidKey = params.get('pid') ? `pinochle-pid-${params.get('pid')}` : 'pinochle-pid';
let devicePid = store.get(pidKey);
if (!devicePid) {
  devicePid = randomId();
  store.set(pidKey, devicePid);
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const ui = {
  net: null, // transport in use
  code: null,
  solo: false, // one device controlling all three seats
  soloSeat: 0,
  game: null,
  unsub: null,
  bidValue: null,
  burySel: [],
  busy: false,
  lastTurnKey: null,
};

const myId = () => (ui.solo ? `solo-${ui.soloSeat}` : devicePid);
const mySeat = () => (ui.game ? seatOf(ui.game, myId()) : -1);

let onlineNet = null;
async function getOnlineNet() {
  if (!firebaseConfig) return null;
  if (!onlineNet) onlineNet = await firebaseTransport(firebaseConfig);
  return onlineNet;
}
const testNet = localTransport();

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 2800);
}

function cardHtml(c, { cls = '', attrs = '' } = {}) {
  const trump = ui.game?.trump && suit(c) === ui.game.trump ? ' trump' : '';
  const tag = attrs.includes('data-act') ? 'button' : 'div';
  return `<${tag} class="card${isRed(c) ? ' red' : ''}${trump} ${cls}" data-card="${c}" ${attrs} aria-label="${RANK_LABEL[rank(c)]} of ${SUIT_NAME[suit(c)]}"><span class="r">${RANK_LABEL[rank(c)]}</span><span class="s">${SUIT_SYMBOL[suit(c)]}</span></${tag}>`;
}
function miniHtml(face) {
  const red = face[1] === 'H' || face[1] === 'D';
  return `<span class="mini${red ? ' red' : ''}">${RANK_LABEL[face[0]]}${SUIT_SYMBOL[face[1]]}</span>`;
}
const suitHtml = (s) => `<span style="color:${s === 'H' || s === 'D' ? '#ff6b6b' : 'inherit'}">${SUIT_SYMBOL[s]}</span>`;

function openSheet(html) {
  $sheet.innerHTML = `<div class="inner">${html}<button class="secondary block" data-close style="margin-top:12px">Close</button></div>`;
  $sheet.hidden = false;
}
$sheet.addEventListener('click', (e) => {
  if (e.target === $sheet || e.target.closest('[data-close]')) $sheet.hidden = true;
});

// ---------------------------------------------------------------------------
// Connecting to a room
// ---------------------------------------------------------------------------
async function openRoom(net, code, { solo = false } = {}) {
  if (ui.unsub) ui.unsub();
  ui.net = net;
  ui.code = code;
  ui.solo = solo;
  ui.game = null;
  ui.burySel = [];
  store.set('pinochle-last-room', JSON.stringify({ code, mode: solo ? 'solo' : net.online ? 'online' : 'test' }));
  if (!solo) {
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    if (!net.online) url.searchParams.set('test', '1');
    history.replaceState(null, '', url);
  }
  ui.unsub = net.subscribe(code, (g) => {
    ui.game = g;
    if (g && ui.solo) followTurn();
    render();
  });
}

async function createRoom(mode) {
  const name = store.get('pinochle-name', '');
  if (!name && mode !== 'solo') return toast('Enter your name first.');
  const net = mode === 'online' ? await getOnlineNet() : testNet;
  if (!net) return toast('Online play is not set up yet. See the README.');
  for (let tries = 0; tries < 5; tries++) {
    const code = (mode === 'solo' ? 'S' : '') + roomCode();
    let g;
    if (mode === 'solo') {
      g = createGame(code, 'solo-0', name || 'Player 1');
      g = apply(g, 'solo-1', { type: 'join', name: 'Player 2' }).state;
      g = apply(g, 'solo-2', { type: 'join', name: 'Player 3' }).state;
    } else {
      g = createGame(code, devicePid, name);
    }
    const res = await net.transact(code, (cur) => (cur ? undefined : g));
    if (res.committed) {
      ui.soloSeat = 0;
      return openRoom(net, code, { solo: mode === 'solo' });
    }
  }
  toast('Could not create a table, try again.');
}

async function joinRoom(code, mode = 'online') {
  code = code.trim().toUpperCase();
  const name = store.get('pinochle-name', '');
  if (!name) return toast('Enter your name first.');
  if (!/^[A-Z]{4}$/.test(code)) return toast('Table codes are 4 letters.');
  const net = mode === 'online' ? await getOnlineNet() : testNet;
  if (!net) return toast('Online play is not set up yet. See the README.');
  let error = null;
  const res = await net.transact(code, (cur) => {
    if (!cur) {
      error = 'No table with that code.';
      return undefined;
    }
    const r = apply(cur, devicePid, { type: 'join', name });
    if (r.error) {
      error = r.error;
      return undefined;
    }
    error = null;
    return r.state;
  });
  if (!res.committed) return toast(error || 'Could not join.');
  openRoom(net, code);
}

function leaveRoom() {
  if (ui.unsub) ui.unsub();
  Object.assign(ui, { unsub: null, game: null, code: null, solo: false, net: null });
  store.set('pinochle-last-room', null);
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('test');
  history.replaceState(null, '', url);
  render();
}

// ---------------------------------------------------------------------------
// Sending actions
// ---------------------------------------------------------------------------
async function act(action) {
  if (!ui.game || ui.busy) return;
  const pid = myId();
  const pre = apply(ui.game, pid, action);
  if (pre.error) return toast(pre.error);
  ui.busy = true;
  let error = null;
  try {
    const res = await ui.net.transact(ui.code, (cur) => {
      if (!cur) return undefined;
      const r = apply(cur, pid, action);
      error = r.error || null;
      return r.error ? undefined : r.state;
    });
    if (!res.committed) toast(error || 'That did not go through. Try again.');
  } catch (e) {
    console.error(e);
    toast('Connection problem. Try again.');
  } finally {
    ui.busy = false;
  }
}

// Whose decision is it right now?
function activeSeat(g) {
  switch (g.phase) {
    case 'bidding':
      return g.bidding.turn;
    case 'kitty':
    case 'trump':
    case 'bury':
    case 'meld':
      return g.bidder;
    case 'play':
      return g.turn;
    default:
      return null;
  }
}

function followTurn() {
  const s = activeSeat(ui.game);
  if (s != null && s !== ui.soloSeat) {
    ui.soloSeat = s;
    ui.burySel = [];
  }
}

function notifyTurn(g) {
  const key = `${g.handNo}-${g.phase}-${g.trickNo}-${g.trick?.cards.length}-${g.bidding?.history.length}`;
  if (!ui.solo && activeSeat(g) === mySeat() && ui.lastTurnKey !== key) {
    try {
      navigator.vibrate?.(120);
    } catch {}
  }
  ui.lastTurnKey = key;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  if (!ui.code) return renderHome();
  const g = ui.game;
  if (!g) {
    $app.innerHTML = `<div class="panel center" style="margin-top:40px"><p>Connecting to table ${esc(ui.code)}…</p><button class="secondary" data-act="leave">Back</button></div>`;
    return;
  }
  if (mySeat() < 0) {
    $app.innerHTML = `<div class="panel center" style="margin-top:40px"><p>You're not seated at table ${esc(ui.code)}.</p><button class="secondary" data-act="leave">Back</button></div>`;
    return;
  }
  notifyTurn(g);
  $app.innerHTML = [topBar(g), ui.solo ? soloBar(g) : '', playersBar(g), phaseView(g), handView(g), logView(g)].join('');
}

function renderHome() {
  const name = store.get('pinochle-name', '');
  const online = !!firebaseConfig;
  const test = params.has('test');
  $app.innerHTML = `
    <h1>♠ Pinochle</h1>
    <p class="muted">Three-handed, with a 3-card kitty.</p>
    ${
      online
        ? ''
        : `<div class="banner">Online play isn't set up yet, so for now you can try the game in Test mode on this phone. To play from three phones, follow "Online setup" in the README.</div>`
    }
    <div class="panel stack">
      <div>
        <label for="name">Your name</label>
        <input id="name" maxlength="16" autocomplete="nickname" value="${esc(name)}" placeholder="Name" />
      </div>
      ${
        online || test
          ? `<button class="block" data-act="create" data-mode="${online && !test ? 'online' : 'test'}">Start a new table</button>
      <div class="row">
        <input id="code" class="code grow" maxlength="4" placeholder="CODE" value="${esc(params.get('room') || '')}" />
        <button data-act="join" data-mode="${online && !test ? 'online' : 'test'}">Join</button>
      </div>`
          : ''
      }
    </div>
    <div class="panel stack">
      <h2>Test mode</h2>
      <p class="muted small">Play all three hands yourself on this one device. Useful for learning the app and checking the rules.</p>
      <button class="secondary block" data-act="create" data-mode="solo">Try it on this device</button>
    </div>`;
}

function topBar(g) {
  return `<div class="topbar">
    <button class="ghost" data-act="leave" aria-label="Leave table">←</button>
    <div class="title">${g.handNo ? `Hand ${g.handNo}` : 'Pinochle'}</div>
    ${ui.solo ? '<span class="code-chip">TEST</span>' : `<button class="ghost code-chip" data-act="share">${esc(g.code)}</button>`}
    <button class="ghost" data-act="scores">Scores</button>
    <button class="ghost" data-act="rules">Rules</button>
  </div>`;
}

function soloBar(g) {
  return `<div class="seat-switch">${g.players
    .map((p, i) => `<button class="${i === ui.soloSeat ? '' : 'secondary'}" data-act="seat" data-seat="${i}">View as ${esc(p.name)}</button>`)
    .join('')}</div>`;
}

function playersBar(g) {
  const act = activeSeat(g);
  const me = mySeat();
  return `<div class="players">${[0, 1, 2]
    .map((i) => {
      const p = g.players[i];
      if (!p) return `<div class="player"><div class="pname muted">Open seat</div><div class="pscore">–</div></div>`;
      const chips = [];
      if (g.dealer === i) chips.push('<span class="chip">Dealer</span>');
      if (g.bidder === i && g.bid) chips.push(`<span class="chip gold">Bid ${g.bid}${g.trump ? ' ' + SUIT_SYMBOL[g.trump] : ''}</span>`);
      if (g.phase === 'bidding') {
        const b = g.bidding;
        if (b.passed[i]) chips.push('<span class="chip">Pass</span>');
        else if (b.highBidder === i) chips.push(`<span class="chip gold">${b.high}</span>`);
      }
      if (g.phase === 'play') chips.push(`<span class="chip">${g.tricksWon[i]} trick${g.tricksWon[i] === 1 ? "" : "s"}</span>`);
      return `<div class="player${act === i ? ' turn' : ''}${me === i ? ' me' : ''}">
        <div class="pname">${esc(p.name)}</div>
        <div class="pscore">${g.scores[i]}</div>
        <div class="chips">${chips.join('')}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function statusLine(text, mine) {
  return `<div class="status${mine ? ' mine' : ''}">${text}</div>`;
}

function phaseView(g) {
  const me = mySeat();
  const nm = (s) => esc(nameOf(g, s));
  switch (g.phase) {
    case 'lobby': {
      const full = g.players.length === NUM_PLAYERS;
      return `<div class="panel stack center">
        <h2>Waiting for players (${g.players.length}/3)</h2>
        <p>Table code</p>
        <div style="font-size:40px;font-weight:800;letter-spacing:8px">${esc(g.code)}</div>
        <button class="secondary" data-act="share">Share invite link</button>
        ${full ? '<button data-act="start">Deal the first hand</button>' : '<p class="muted small">Send the code or link to your friends.</p>'}
      </div>`;
    }
    case 'bidding': {
      const b = g.bidding;
      const mine = b.turn === me;
      const min = minNextBid(g);
      const bidKey = `${g.handNo}-${b.history.length}`;
      if (ui.bidKey !== bidKey || ui.bidValue < min) {
        ui.bidKey = bidKey;
        ui.bidValue = min;
      }
      const hist = b.history.length
        ? `<p class="small muted">${b.history.map((h) => `${nm(h.seat)}: ${h.bid ?? 'pass'}`).join(' · ')}</p>`
        : '';
      return `<div class="panel stack center">
        <div>High bid: <b>${b.high ?? 'none'}</b>${b.highBidder != null ? ` by ${nm(b.highBidder)}` : ''}</div>
        ${hist}
        ${kittyBacks()}
        ${
          mine
            ? `${statusLine('Your bid', true)}
          <div class="stepper">
            <button class="secondary" data-act="bidstep" data-d="-5">−5</button>
            <button class="secondary" data-act="bidstep" data-d="-1">−</button>
            <div class="val">${ui.bidValue}</div>
            <button class="secondary" data-act="bidstep" data-d="1">+</button>
            <button class="secondary" data-act="bidstep" data-d="5">+5</button>
          </div>
          <div class="row"><button class="secondary grow" data-act="pass">Pass</button><button class="grow" data-act="bid">Bid ${ui.bidValue}</button></div>`
            : statusLine(`Waiting for ${nm(b.turn)} to bid…`)
        }
      </div>`;
    }
    case 'kitty': {
      const mine = g.bidder === me;
      return `<div class="panel stack center">
        <div>${nm(g.bidder)} won the bid at <b>${g.bid}</b>. The kitty:</div>
        <div class="cards-row">${g.kitty.map((c) => cardHtml(c)).join('')}</div>
        ${mine ? '<button data-act="takeKitty">Pick up the kitty</button>' : statusLine(`Waiting for ${nm(g.bidder)}…`)}
      </div>`;
    }
    case 'trump': {
      if (g.bidder !== me) return `<div class="panel">${statusLine(`${nm(g.bidder)} is choosing trump…`)}</div>`;
      const hand = g.hands[me];
      return `<div class="panel stack">
        ${statusLine('Choose trump', true)}
        <p class="small muted center">Meld shown is for your 18 cards, before you bury 3.</p>
        <div class="suits">${['S', 'H', 'C', 'D']
          .map((s) => {
            const m = computeMeld(hand, s, g.rules).total;
            return `<button class="${s === 'H' || s === 'D' ? 'red' : ''}" data-act="trump" data-suit="${s}"><span class="big">${SUIT_SYMBOL[s]}</span>${SUIT_NAME[s]}<span class="sub">meld ${m}</span></button>`;
          })
          .join('')}</div>
      </div>`;
    }
    case 'bury': {
      if (g.bidder !== me) return `<div class="panel">${statusLine(`${nm(g.bidder)} is burying 3 cards…`)}</div>`;
      const left = g.hands[me].filter((c) => !ui.burySel.includes(c));
      const meld = computeMeld(left, g.trump, g.rules).total;
      return `<div class="panel stack center">
        ${statusLine(`Tap 3 cards to bury (${ui.burySel.length}/3)`, true)}
        <p class="small muted">Buried cards go in your trick pile${g.rules.buryTrumpAllowed ? '' : '. Trump can\'t be buried'}.</p>
        <p class="small muted">Trump: ${suitHtml(g.trump)} ${SUIT_NAME[g.trump]} · Meld with what's left: <b>${meld}</b></p>
        <button data-act="bury" ${ui.burySel.length === 3 ? '' : 'disabled'}>Bury these 3</button>
      </div>`;
    }
    case 'meld': {
      const mine = g.bidder === me;
      const need = Math.max(0, g.bid - g.melds[g.bidder].total);
      return `<div class="panel stack">
        <h2 class="center">Meld · Trump ${suitHtml(g.trump)}</h2>
        ${meldList(g)}
        <p class="center small muted">${nm(g.bidder)} needs <b>${need}</b> from tricks to make ${g.bid}.</p>
        ${
          mine
            ? `<div class="row"><button class="grow" data-act="playHand">Play it out</button>${
                g.rules.allowConcede ? '<button class="danger grow" data-act="concede">Throw in</button>' : ''
              }</div>`
            : statusLine(`Waiting for ${nm(g.bidder)} to play or throw in…`)
        }
      </div>`;
    }
    case 'play':
      return trickView(g);
    case 'handOver':
    case 'gameOver':
      return handSummary(g);
  }
  return '';
}

function kittyBacks() {
  return `<div class="cards-row">${'<div class="card back" style="width:40px"></div>'.repeat(3)}</div>`;
}

function meldList(g) {
  return `<div class="meld-list">${[0, 1, 2]
    .map((s) => {
      const m = g.melds[s];
      return `<div>
        <div class="meld-item"><b>${esc(nameOf(g, s))}</b><b>${m.total}</b></div>
        ${
          m.items.length
            ? m.items
                .map((it) => `<div class="meld-item small"><span class="mini-cards">${it.cards.map(miniHtml).join('')}</span><span class="muted">${esc(it.name)} ${it.points}</span></div>`)
                .join('')
            : '<div class="small muted">No meld</div>'
        }
      </div>`;
    })
    .join('')}</div>`;
}

function trickView(g) {
  const me = mySeat();
  const left = (me + 1) % 3;
  const right = (me + 2) % 3;
  const current = g.trick.cards;
  const showing = current.length ? current : g.lastTrick ? g.lastTrick.cards : [];
  const winSeat = current.length ? current[trickWinnerIndex(current, g.trump)].seat : g.lastTrick?.winner;
  const slot = (seat, cls) => {
    const played = showing.find((x) => x.seat === seat);
    return `<div class="slot ${cls}${played && winSeat === seat ? ' win' : ''}">
      ${played ? cardHtml(played.card) : '<div class="empty"></div>'}
      <div class="who">${esc(nameOf(g, seat))}${seat === me ? ' (you)' : ''}</div>
    </div>`;
  };
  const broken = g.rules.trumpMustBeBroken ? `<br><span class="small">${g.trumpBroken ? 'Trump broken' : 'Trump not broken'}</span>` : '';
  let info = `Trick ${Math.min(g.trickNo + 1, 15)} of 15<br>Trump ${suitHtml(g.trump)}${broken}`;
  if (!current.length && g.lastTrick) info = `${esc(nameOf(g, g.lastTrick.winner))} took trick ${g.lastTrick.trickNo}<br>Trump ${suitHtml(g.trump)}${broken}`;
  const mine = g.turn === me;
  return `<div class="panel">
    <div class="table">${slot(left, 'slot-left')}<div class="info">${info}</div>${slot(right, 'slot-right')}${slot(me, 'slot-me')}</div>
    ${statusLine(mine ? (current.length ? 'Your turn' : 'Your lead') : `Waiting for ${esc(nameOf(g, g.turn))}…`, mine)}
  </div>`;
}

function handSummary(g) {
  const h = g.lastHand;
  const nm = (s) => esc(nameOf(g, s));
  const fmt = (n) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${n}</span>`;
  const rows = [0, 1, 2]
    .map(
      (s) => `<tr><td>${nm(s)}${s === h.bidder ? ' ★' : ''}</td><td>${h.conceded ? h.meld[s] : h.meldPts[s]}</td><td>${h.conceded ? '–' : h.trickPts[s]}</td><td>${fmt(h.delta[s])}</td><td><b>${g.scores[s]}</b></td></tr>`,
    )
    .join('');
  const headline = h.conceded
    ? `${nm(h.bidder)} threw in the hand (bid ${h.bid}).`
    : h.made
      ? `${nm(h.bidder)} made the bid: ${h.totals[h.bidder]} of ${h.bid}.`
      : `${nm(h.bidder)} went set: ${h.totals[h.bidder]} of ${h.bid}.`;
  const over = g.phase === 'gameOver';
  return `<div class="panel stack">
    ${over ? `<h2 class="center">🏆 ${nm(g.winner)} wins!</h2>` : `<h2 class="center">Hand ${h.handNo} done</h2>`}
    <p class="center">${headline}</p>
    <table class="scores"><thead><tr><th></th><th>Meld</th><th>Tricks</th><th>Hand</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${!h.conceded && g.rules.meldRequiresTrick ? '<p class="small muted">Meld only counts if that player took a trick.</p>' : ''}
    <p class="small muted">Buried: ${g.buried.map((c) => miniHtml(c.slice(0, 2))).join(' ')}</p>
    ${over ? '<button data-act="newGame">Start a new game</button>' : '<button data-act="nextHand">Deal next hand</button>'}
  </div>`;
}

function handView(g) {
  if (!g.hands || ['lobby'].includes(g.phase)) return '';
  const me = mySeat();
  let hand = g.hands[me];
  if (!hand.length) return '';
  hand = sortHand(hand, g.trump);
  const legal = new Set(legalPlays(g, me));
  const playing = g.phase === 'play' && g.turn === me;
  const burying = g.phase === 'bury' && g.bidder === me;
  const cols = Math.ceil(hand.length / 2);
  const cards = hand
    .map((c) => {
      if (playing) return cardHtml(c, { cls: legal.has(c) ? 'playable' : 'dim', attrs: `data-act="play"${legal.has(c) ? '' : ' aria-disabled="true"'}` });
      if (burying) {
        if (!g.rules.buryTrumpAllowed && suit(c) === g.trump) return cardHtml(c, { cls: 'dim', attrs: 'data-act="noBury"' });
        return cardHtml(c, { cls: `playable${ui.burySel.includes(c) ? ' selected' : ''}`, attrs: 'data-act="toggleBury"' });
      }
      return cardHtml(c);
    })
    .join('');
  return `<div class="hand" style="--cols:${cols}">${cards}</div>`;
}

function logView(g) {
  return `<div class="log">${g.log.slice(-4).reverse().map(esc).join('<br>')}</div>`;
}

function scoresSheet(g) {
  const nm = (s) => esc(nameOf(g, s));
  const rows = g.history
    .map(
      (h) =>
        `<tr><td>${h.handNo}</td><td>${nm(h.bidder)} ${h.bid}${h.trump ? ' ' + SUIT_SYMBOL[h.trump] : ''}${h.conceded ? ' (in)' : h.made ? '' : ' (set)'}</td>${h.scores
          .map((s, i) => `<td>${s}<br><span class="small ${h.delta[i] >= 0 ? 'pos' : 'neg'}">${h.delta[i] >= 0 ? '+' : ''}${h.delta[i]}</span></td>`)
          .join('')}</tr>`,
    )
    .join('');
  openSheet(`<h2>Scores · first to ${g.rules.targetScore}</h2>
    <table class="scores"><thead><tr><th>#</th><th>Bid</th>${[0, 1, 2].map((s) => `<th>${nm(s)}</th>`).join('')}</tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">No hands played yet.</td></tr>'}</tbody></table>`);
}

function rulesSheet(g) {
  const r = g.rules;
  const m = r.meld;
  const cp = Object.entries(r.cardPoints)
    .filter(([, v]) => v)
    .map(([k, v]) => `${RANK_LABEL[k]}=${v}`)
    .join(', ');
  openSheet(`<h2>Rules at this table</h2>
    <ul class="small">
      <li>48-card deck (9 through A, two of each). 15 cards each, 3 in the kitty.</li>
      <li>Bidding starts left of the dealer at ${r.minBid}, up by ${r.bidIncrement}. Once you pass you're out.
        ${r.allPassAction === 'dealerStuck' ? 'If everyone passes, the dealer takes it at the minimum.' : 'If everyone passes, the hand is redealt.'}</li>
      <li>The kitty is shown to everyone. The high bidder takes it, names trump, and buries 3 cards in their trick pile${r.buryTrumpAllowed ? '' : ' (no trump)'}${r.buriedPointsToBidder ? '; their points count for the bidder' : ''}. Then everyone melds.</li>
      <li>Bidder leads first.${r.trumpMustBeBroken ? " Trump can't be led until someone has played it because they couldn't follow suit, unless you have nothing but trump left." : ''} Follow suit${r.mustHead ? ' and beat the winning card if you can' : ''}. If you can't follow${
        r.mustTrump ? `, you must trump${r.mustOvertrump ? ' (over-trumping if you can)' : ''}` : ', play anything'
      }. Of two identical cards, the first one played wins.</li>
      <li>Counters: ${cp}. Last trick: ${r.lastTrickBonus}.</li>
      <li>${r.meldRequiresTrick ? 'Your meld only counts if you take at least one trick.' : 'Meld always counts.'}</li>
      <li>Bidder makes it with meld + trick points ≥ bid and scores ${r.bidderMadeScores === 'bid' ? 'the bid' : 'everything they made'}; otherwise loses ${r.setPenalty === 'doubleBid' ? 'double ' : ''}the bid.</li>
      ${r.allowConcede ? `<li>Bidder may throw in after seeing meld: loses the bid${r.concedeOpponentsGetMeld ? ', others score their meld' : ''}.</li>` : ''}
      <li>First to ${r.targetScore} wins.</li>
    </ul>
    <h2>Meld</h2>
    <table class="scores small"><tbody>
      <tr><td>Run (A-10-K-Q-J trump)</td><td>${m.run}</td><td>double ${m.doubleRun}</td></tr>
      <tr><td>Royal marriage</td><td>${m.royalMarriage}</td><td></td></tr>
      <tr><td>Marriage</td><td>${m.marriage}</td><td></td></tr>
      <tr><td>Dix (9 of trump)</td><td>${m.dix}</td><td></td></tr>
      <tr><td>Pinochle (Q♠ J♦)</td><td>${m.pinochle}</td><td>double ${m.doublePinochle}</td></tr>
      <tr><td>Aces around</td><td>${m.acesAround}</td><td>double ${m.doubleAces}</td></tr>
      <tr><td>Kings around</td><td>${m.kingsAround}</td><td>double ${m.doubleKings}</td></tr>
      <tr><td>Queens around</td><td>${m.queensAround}</td><td>double ${m.doubleQueens}</td></tr>
      <tr><td>Jacks around</td><td>${m.jacksAround}</td><td>double ${m.doubleJacks}</td></tr>
    </tbody></table>`);
}

async function share(g) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', g.code);
  if (!ui.net.online) url.searchParams.set('test', '1');
  const text = `Join my Pinochle table: ${g.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: 'Pinochle', text, url: url.href });
  } catch {
    return;
  }
  try {
    await navigator.clipboard.writeText(url.href);
    toast('Invite link copied.');
  } catch {
    toast(`Table code: ${g.code}`);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
$app.addEventListener('input', (e) => {
  if (e.target.id === 'name') store.set('pinochle-name', e.target.value.trim());
});

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  const g = ui.game;
  switch (a) {
    case 'create':
      return createRoom(el.dataset.mode);
    case 'join':
      return joinRoom(document.getElementById('code').value, el.dataset.mode);
    case 'leave':
      return leaveRoom();
    case 'share':
      return share(g);
    case 'scores':
      return scoresSheet(g);
    case 'rules':
      return rulesSheet(g);
    case 'seat':
      ui.soloSeat = Number(el.dataset.seat);
      ui.burySel = [];
      return render();
    case 'start':
      return act({ type: 'start' });
    case 'bidstep':
      ui.bidValue = Math.max(minNextBid(g), ui.bidValue + Number(el.dataset.d) * g.rules.bidIncrement);
      return render();
    case 'bid':
      return act({ type: 'bid', amount: ui.bidValue });
    case 'pass':
      return act({ type: 'pass' });
    case 'takeKitty':
      return act({ type: 'takeKitty' });
    case 'trump':
      return act({ type: 'trump', suit: el.dataset.suit });
    case 'noBury':
      return toast("You can't bury trump.");
    case 'toggleBury': {
      const c = el.dataset.card;
      if (ui.burySel.includes(c)) ui.burySel = ui.burySel.filter((x) => x !== c);
      else if (ui.burySel.length < 3) ui.burySel.push(c);
      return render();
    }
    case 'bury': {
      const cards = ui.burySel;
      ui.burySel = [];
      return act({ type: 'bury', cards });
    }
    case 'playHand':
      return act({ type: 'playHand' });
    case 'concede':
      if (!confirm(`Throw in the hand? You'll lose ${g.bid}.`)) return;
      return act({ type: 'concede' });
    case 'play':
      if (el.getAttribute('aria-disabled')) {
        const r = apply(g, myId(), { type: 'play', card: el.dataset.card });
        return toast(r.error || 'You cannot play that card.');
      }
      return act({ type: 'play', card: el.dataset.card });
    case 'nextHand':
      return act({ type: 'nextHand' });
    case 'newGame':
      return act({ type: 'newGame' });
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function boot() {
  render();
  const roomParam = params.get('room');
  const last = (() => {
    try {
      return JSON.parse(store.get('pinochle-last-room', 'null'));
    } catch {
      return null;
    }
  })();
  try {
    if (roomParam) {
      const mode = params.has('test') ? 'test' : 'online';
      const net = mode === 'online' ? await getOnlineNet() : testNet;
      if (!net) return;
      // Already seated? Reopen. Otherwise leave the code in the Join box.
      const cur = await net.get(roomParam.toUpperCase());
      if (cur && seatOf(cur, devicePid) >= 0) return openRoom(net, roomParam.toUpperCase());
      return;
    }
    if (last?.code) {
      const net = last.mode === 'online' ? await getOnlineNet() : testNet;
      if (net) openRoom(net, last.code, { solo: last.mode === 'solo' });
    }
  } catch (e) {
    console.error(e);
    toast('Could not connect. Check your internet connection.');
  }
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
