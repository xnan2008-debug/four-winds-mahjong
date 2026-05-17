const TILE_DEFS = [
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `b${index + 1}`,
    rank: index + 1,
    suit: "bamboo",
    label: "Bam",
    glyph: ["一", "二", "三", "四", "五", "六", "七", "八", "九"][index],
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `c${index + 1}`,
    rank: index + 1,
    suit: "character",
    label: "Wan",
    glyph: ["一", "二", "三", "四", "五", "六", "七", "八", "九"][index],
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `d${index + 1}`,
    rank: index + 1,
    suit: "dot",
    label: "Dot",
    glyph: ["一", "二", "三", "四", "五", "六", "七", "八", "九"][index],
  })),
  { id: "we", rank: 1, suit: "wind", label: "East", glyph: "東" },
  { id: "ws", rank: 2, suit: "wind", label: "South", glyph: "南" },
  { id: "ww", rank: 3, suit: "wind", label: "West", glyph: "西" },
  { id: "wn", rank: 4, suit: "wind", label: "North", glyph: "北" },
  { id: "dr", rank: 1, suit: "dragon-red", label: "Red", glyph: "中" },
  { id: "dg", rank: 2, suit: "dragon-green", label: "Green", glyph: "發" },
  { id: "dw", rank: 3, suit: "dragon-white", label: "White", glyph: "白" },
];

const TILE_LOOKUP = Object.fromEntries(TILE_DEFS.map((tile) => [tile.id, tile]));
const SEATS = [
  { name: "Black Widow", wind: "East", human: true },
  { name: "Hulk", wind: "South", human: false },
  { name: "Captain America", wind: "West", human: true },
  { name: "Ironman", wind: "North", human: false },
];

const state = {
  players: [],
  wall: [],
  current: 0,
  drawn: true,
  lastDiscard: null,
  pendingCalls: [],
  gameOver: false,
};

const online = {
  enabled: false,
  room: null,
  seat: null,
  polling: null,
};

const els = {
  wallCount: document.querySelector("#wallCount"),
  roundText: document.querySelector("#roundText"),
  turnBadge: document.querySelector("#turnBadge"),
  statusTitle: document.querySelector("#statusTitle"),
  statusText: document.querySelector("#statusText"),
  drawButton: document.querySelector("#drawButton"),
  winButton: document.querySelector("#winButton"),
  passButton: document.querySelector("#passButton"),
  newGameButton: document.querySelector("#newGameButton"),
  createRoomButton: document.querySelector("#createRoomButton"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  joinEastButton: document.querySelector("#joinEastButton"),
  joinWestButton: document.querySelector("#joinWestButton"),
  roomStatus: document.querySelector("#roomStatus"),
  roomLinks: document.querySelector("#roomLinks"),
  logList: document.querySelector("#logList"),
  callPanel: document.querySelector("#callPanel"),
  lastDiscardSlot: document.querySelector("#lastDiscardSlot"),
  tileTemplate: document.querySelector("#tileTemplate"),
};

function buildWall() {
  const wall = [];
  TILE_DEFS.forEach((tile) => {
    for (let copy = 0; copy < 4; copy += 1) {
      wall.push(tile.id);
    }
  });
  return shuffle(wall);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startGame() {
  state.wall = buildWall();
  state.players = SEATS.map((seat) => ({
    ...seat,
    hand: [],
    melds: [],
    discards: [],
  }));
  state.current = 0;
  state.drawn = true;
  state.lastDiscard = null;
  state.pendingCalls = [];
  state.gameOver = false;
  els.logList.innerHTML = "";
  els.callPanel.classList.add("hidden");
  els.passButton.classList.add("hidden");
  els.lastDiscardSlot.innerHTML = "";

  for (let tile = 0; tile < 13; tile += 1) {
    state.players.forEach((player) => player.hand.push(drawTile()));
  }
  state.players[0].hand.push(drawTile());
  state.players.forEach((player) => sortHand(player.hand));
  log("East begins with 14 tiles.");
  render();
}

function drawTile() {
  return state.wall.pop();
}

function sortHand(hand) {
  hand.sort((a, b) => tileIndex(a) - tileIndex(b));
}

function tileIndex(id) {
  return TILE_DEFS.findIndex((tile) => tile.id === id);
}

function currentPlayer() {
  return state.players[state.current];
}

function advanceTurn() {
  state.current = (state.current + 1) % state.players.length;
  state.drawn = false;
  state.lastDiscard = null;
  render();
  if (!currentPlayer().human) {
    window.setTimeout(playNpcTurn, 650);
  }
}

function humanCanAct() {
  const isOnlineViewer = !online.enabled || online.seat === state.current;
  return !state.gameOver && currentPlayer().human && isOnlineViewer && state.pendingCalls.length === 0;
}

function drawForCurrent() {
  if (online.enabled) {
    postAction({ type: "draw" });
    return;
  }
  if (!humanCanAct() || state.drawn) return;
  const tile = drawTile();
  if (!tile) {
    endDraw();
    return;
  }
  currentPlayer().hand.push(tile);
  sortHand(currentPlayer().hand);
  state.drawn = true;
  log(`${currentPlayer().name} draws.`);
  setStatus(`${currentPlayer().name} drew a tile`, "Choose a discard, or declare a winning hand.");
  render();
}

function discardFromCurrent(tileId, tilePosition) {
  if (online.enabled) {
    postAction({ type: "discard", tileIndex: tilePosition });
    return;
  }
  if (!humanCanAct() || !state.drawn) return;
  discardTile(state.current, tilePosition ?? currentPlayer().hand.indexOf(tileId));
}

function discardTile(playerIndex, handIndex) {
  const player = state.players[playerIndex];
  const [tile] = player.hand.splice(handIndex, 1);
  player.discards.push(tile);
  state.lastDiscard = { tile, from: playerIndex };
  state.drawn = false;
  log(`${player.name} discards ${tileText(tile)}.`);
  gatherCalls(tile, playerIndex);
  render();
  if (state.pendingCalls.length > 0) {
    resolveCalls();
  } else {
    advanceTurn();
  }
}

function gatherCalls(tile, fromIndex) {
  state.pendingCalls = [];
  state.players.forEach((player, index) => {
    if (index === fromIndex) return;
    const options = getCallOptions(player, index, tile, fromIndex);
    if (options.length > 0) {
      state.pendingCalls.push({ playerIndex: index, options });
    }
  });
  state.pendingCalls.sort((a, b) => {
    const priorityDifference = bestCallPriority(b.options) - bestCallPriority(a.options);
    if (priorityDifference !== 0) return priorityDifference;
    if (state.players[a.playerIndex].human !== state.players[b.playerIndex].human) {
      return state.players[a.playerIndex].human ? -1 : 1;
    }
    return turnDistance(fromIndex, a.playerIndex) - turnDistance(fromIndex, b.playerIndex);
  });
}

function getCallOptions(player, playerIndex, tile, fromIndex) {
  const options = [];
  const testHand = [...player.hand, tile];
  if (isWinningHand(testHand, player.melds.length)) {
    options.push({ type: "win", label: "Win" });
  }

  const count = player.hand.filter((item) => item === tile).length;
  if (count >= 3) options.push({ type: "kong", label: "Kong", tiles: [tile, tile, tile] });
  if (count >= 2) options.push({ type: "pong", label: "Pong", tiles: [tile, tile] });

  const nextPlayer = (fromIndex + 1) % state.players.length;
  if (playerIndex === nextPlayer) {
    getChowOptions(player.hand, tile).forEach((tiles) => {
      options.push({ type: "chow", label: `Chow ${tiles.map(tileShort).join("-")}`, tiles });
    });
  }
  return options;
}

function getChowOptions(hand, tile) {
  const def = TILE_LOOKUP[tile];
  if (!["bamboo", "character", "dot"].includes(def.suit)) return [];
  const options = [];
  const ids = [-2, -1, 0].map((offset) => [def.rank + offset, def.rank + offset + 1, def.rank + offset + 2]);
  ids.forEach((sequence) => {
    if (!sequence.includes(def.rank) || sequence.some((rank) => rank < 1 || rank > 9)) return;
    const needed = sequence.filter((rank) => rank !== def.rank).map((rank) => `${tile[0]}${rank}`);
    if (needed.every((id) => hand.includes(id))) options.push(needed);
  });
  return options;
}

function resolveCalls() {
  const candidate = state.pendingCalls[0];
  const player = state.players[candidate.playerIndex];
  const humanOptions = candidate.options.filter((option) => player.human || option.type === "win" || shouldNpcCall(option, player));

  if (!player.human) {
    const option = humanOptions[0];
    if (option) {
      window.setTimeout(() => takeCall(candidate.playerIndex, option), 550);
      return;
    }
    state.pendingCalls.shift();
    if (state.pendingCalls.length) resolveCalls();
    else advanceTurn();
    return;
  }

  showCallPanel(candidate.playerIndex, candidate.options);
  setStatus(`${player.name} may call`, `Claim ${tileText(state.lastDiscard.tile)} or pass.`);
}

function bestCallPriority(options) {
  return Math.max(...options.map(optionPriority));
}

function optionPriority(option) {
  if (option.type === "win") return 3;
  if (option.type === "pong" || option.type === "kong") return 2;
  return 1;
}

function turnDistance(fromIndex, playerIndex) {
  return (playerIndex - fromIndex + state.players.length) % state.players.length;
}

function showCallPanel(playerIndex, options) {
  els.callPanel.innerHTML = "";
  options.forEach((option, optionIndex) => {
    const button = document.createElement("button");
    button.className = option.type === "win" ? "primary-button alt" : "primary-button";
    button.type = "button";
    button.textContent = `${option.label}?`;
    button.addEventListener("click", () => {
      if (online.enabled) postAction({ type: "call", callIndex: optionIndex });
      else takeCall(playerIndex, option);
    });
    els.callPanel.append(button);
  });
  const passButton = document.createElement("button");
  passButton.className = "ghost-button";
  passButton.type = "button";
  passButton.textContent = "Pass";
  passButton.addEventListener("click", passCall);
  els.callPanel.append(passButton);
  els.passButton.classList.remove("hidden");
  els.callPanel.classList.remove("hidden");
}

function passCall() {
  if (online.enabled) {
    postAction({ type: "pass" });
    return;
  }
  if (state.pendingCalls.length === 0) return;
  els.callPanel.classList.add("hidden");
  els.passButton.classList.add("hidden");
  state.pendingCalls.shift();
  if (state.pendingCalls.length > 0) {
    resolveCalls();
  } else {
    advanceTurn();
  }
}

function takeCall(playerIndex, option) {
  const player = state.players[playerIndex];
  els.callPanel.classList.add("hidden");
  els.passButton.classList.add("hidden");

  if (option.type === "win") {
    player.hand.push(state.lastDiscard.tile);
    sortHand(player.hand);
    finishWin(playerIndex, `${player.name} wins on ${state.players[state.lastDiscard.from].name}'s discard.`);
    return;
  }

  removeLastDiscard();
  option.tiles.forEach((tile) => removeOne(player.hand, tile));
  player.melds.push({ type: option.type, tiles: [...option.tiles, state.lastDiscard.tile].sort((a, b) => tileIndex(a) - tileIndex(b)) });
  if (option.type === "kong") {
    const replacement = drawTile();
    if (!replacement) {
      endDraw();
      return;
    }
    player.hand.push(replacement);
    log(`${player.name} draws a kong replacement.`);
  }
  state.current = playerIndex;
  state.drawn = true;
  state.pendingCalls = [];
  sortHand(player.hand);
  log(`${player.name} calls ${option.type}.`);
  setStatus(`${player.name} called ${option.type}`, "That player must discard next.");
  render();
  if (!player.human) {
    window.setTimeout(() => discardNpcTile(playerIndex), 700);
  }
}

function removeLastDiscard() {
  const fromPlayer = state.players[state.lastDiscard.from];
  fromPlayer.discards.pop();
}

function removeOne(hand, tile) {
  const index = hand.indexOf(tile);
  if (index >= 0) hand.splice(index, 1);
}

function shouldNpcCall(option, player) {
  if (option.type === "win") return true;
  if (option.type === "kong") return true;
  if (option.type === "pong") return countPairs(player.hand) < 4;
  return Math.random() < 0.35;
}

function playNpcTurn() {
  if (state.gameOver || currentPlayer().human) return;
  const player = currentPlayer();
  if (!state.drawn) {
    const tile = drawTile();
    if (!tile) {
      endDraw();
      return;
    }
    player.hand.push(tile);
    sortHand(player.hand);
    state.drawn = true;
    log(`${player.name} draws.`);
  }

  if (isWinningHand(player.hand, player.melds.length)) {
    finishWin(state.current, `${player.name} wins by self-draw.`);
    return;
  }
  window.setTimeout(() => discardNpcTile(state.current), 550);
}

function discardNpcTile(playerIndex) {
  if (state.gameOver) return;
  const player = state.players[playerIndex];
  const index = chooseNpcDiscard(player.hand);
  discardTile(playerIndex, index);
}

function chooseNpcDiscard(hand) {
  const counts = countTiles(hand);
  let bestIndex = 0;
  let bestScore = Infinity;
  hand.forEach((tile, index) => {
    const def = TILE_LOOKUP[tile];
    let score = counts[tile] * -8;
    if (["bamboo", "character", "dot"].includes(def.suit)) {
      const left = counts[`${tile[0]}${def.rank - 1}`] || 0;
      const right = counts[`${tile[0]}${def.rank + 1}`] || 0;
      const farLeft = counts[`${tile[0]}${def.rank - 2}`] || 0;
      const farRight = counts[`${tile[0]}${def.rank + 2}`] || 0;
      score -= left * 3 + right * 3 + farLeft + farRight;
      if (def.rank === 1 || def.rank === 9) score += 2;
    } else {
      score += counts[tile] === 1 ? 8 : -5;
    }
    if (score < bestScore || (score === bestScore && Math.random() < 0.5)) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function declareWin() {
  if (online.enabled) {
    postAction({ type: "win" });
    return;
  }
  if (!humanCanAct()) return;
  const player = currentPlayer();
  if (isWinningHand(player.hand, player.melds.length)) {
    finishWin(state.current, `${player.name} wins by self-draw.`);
  } else {
    setStatus("Not a winning hand yet", "You need four melds and a pair, or seven pairs.");
  }
}

function finishWin(playerIndex, message) {
  state.gameOver = true;
  log(message);
  render();
  const overlay = document.createElement("div");
  overlay.className = "win-overlay";
  overlay.innerHTML = `
    <div class="win-card">
      <h2>${state.players[playerIndex].name} wins</h2>
      <p>${message}</p>
      <button class="primary-button" type="button">Play another hand</button>
    </div>
  `;
  overlay.querySelector("button").addEventListener("click", () => {
    overlay.remove();
    startGame();
  });
  document.body.append(overlay);
}

function endDraw() {
  state.gameOver = true;
  setStatus("Exhaustive draw", "The wall is empty. Start a new hand.");
  log("The hand ends in a draw.");
  render();
}

function isWinningHand(hand, openMeldCount = 0) {
  if ((hand.length + openMeldCount * 3) % 3 !== 2) return false;
  if (openMeldCount === 0 && isSevenPairs(hand)) return true;
  const groupsNeeded = 4 - openMeldCount;
  const counts = countTiles(hand);
  return Object.keys(counts).some((tile) => {
    if (counts[tile] < 2) return false;
    counts[tile] -= 2;
    const result = canMakeGroups(counts, groupsNeeded);
    counts[tile] += 2;
    return result;
  });
}

function isSevenPairs(hand) {
  if (hand.length !== 14) return false;
  const counts = countTiles(hand);
  return Object.values(counts).every((count) => count === 2);
}

function canMakeGroups(counts, groupsLeft) {
  if (groupsLeft === 0) return Object.values(counts).every((count) => count === 0);
  const tile = Object.keys(counts)
    .filter((id) => counts[id] > 0)
    .sort((a, b) => tileIndex(a) - tileIndex(b))[0];
  if (!tile) return groupsLeft === 0;

  if (counts[tile] >= 3) {
    counts[tile] -= 3;
    if (canMakeGroups(counts, groupsLeft - 1)) {
      counts[tile] += 3;
      return true;
    }
    counts[tile] += 3;
  }

  const def = TILE_LOOKUP[tile];
  if (["bamboo", "character", "dot"].includes(def.suit) && def.rank <= 7) {
    const next = `${tile[0]}${def.rank + 1}`;
    const after = `${tile[0]}${def.rank + 2}`;
    if ((counts[next] || 0) > 0 && (counts[after] || 0) > 0) {
      counts[tile] -= 1;
      counts[next] -= 1;
      counts[after] -= 1;
      if (canMakeGroups(counts, groupsLeft - 1)) {
        counts[tile] += 1;
        counts[next] += 1;
        counts[after] += 1;
        return true;
      }
      counts[tile] += 1;
      counts[next] += 1;
      counts[after] += 1;
    }
  }
  return false;
}

function countTiles(hand) {
  return hand.reduce((counts, tile) => {
    counts[tile] = (counts[tile] || 0) + 1;
    return counts;
  }, {});
}

function countPairs(hand) {
  return Object.values(countTiles(hand)).filter((count) => count >= 2).length;
}

function render() {
  visualSeatMap().forEach((playerIndex, visualIndex) => {
    const player = state.players[playerIndex];
    const seat = document.querySelector(`[data-seat="${visualIndex}"]`);
    seat.classList.toggle("active", playerIndex === state.current && !state.gameOver);
    renderSeatHeader(player, visualIndex);
    renderHand(player, playerIndex, visualIndex);
    renderMelds(player, visualIndex);
    renderDiscards(player, visualIndex);
  });

  els.wallCount.textContent = state.wall.length;
  els.turnBadge.textContent = state.gameOver ? "Hand ended" : `${currentPlayer().wind} turn`;
  els.drawButton.disabled = !humanCanAct() || state.drawn;
  els.winButton.disabled = !humanCanAct();
  els.roundText.textContent = `East round • dealer: ${state.players[0].name}`;
  renderLastDiscard();

  if (!state.gameOver && state.pendingCalls.length === 0) {
    if (currentPlayer().human) {
      setStatus(
        `${currentPlayer().name}'s turn`,
        state.drawn ? "Discard a tile from your hand." : "Draw from the wall."
      );
    } else {
      setStatus(`${currentPlayer().name} is thinking`, "The NPC will draw and discard automatically.");
    }
  }
}

function visualSeatMap() {
  if (!online.enabled || online.seat === 0) return [0, 1, 2, 3];
  if (online.seat === 2) return [2, 3, 0, 1];
  return [online.seat, (online.seat + 1) % 4, (online.seat + 2) % 4, (online.seat + 3) % 4];
}

function renderSeatHeader(player, visualIndex) {
  const seat = document.querySelector(`[data-seat="${visualIndex}"]`);
  seat.dataset.character = characterSlug(player.name);
  seat.querySelector("strong").textContent = player.name;
  seat.querySelector("small").textContent = player.human ? (player.name === "Black Widow" ? "Human 1" : "Human 2") : "NPC";
}

function characterSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function renderHand(player, playerIndex, visualIndex) {
  const container = document.querySelector(`#hand-${visualIndex}`);
  container.innerHTML = "";
  const activeHumanIndex = state.pendingCalls.length > 0 ? state.pendingCalls[0].playerIndex : state.current;
  const hidden = online.enabled ? playerIndex !== online.seat : (!player.human || (player.human && playerIndex !== activeHumanIndex));
  player.hand.forEach((tile, index) => {
    const tileEl = hidden || tile === null ? createTileBack() : createTile(tile);
    tileEl.classList.toggle("selectable", playerIndex === state.current && player.human && state.drawn && (!online.enabled || playerIndex === online.seat));
    if (!hidden && playerIndex === state.current && player.human && state.drawn && (!online.enabled || playerIndex === online.seat)) {
      tileEl.addEventListener("click", () => discardFromCurrent(tile, index));
    }
    container.append(tileEl);
  });
}

function renderMelds(player, visualIndex) {
  const container = document.querySelector(`#melds-${visualIndex}`);
  container.innerHTML = "";
  player.melds.forEach((meld) => {
    const meldEl = document.createElement("div");
    meldEl.className = "meld";
    meld.tiles.forEach((tile) => meldEl.append(createTile(tile, "small")));
    container.append(meldEl);
  });
}

function renderDiscards(player, visualIndex) {
  const container = document.querySelector(`#discards-${visualIndex}`);
  container.innerHTML = "";
  player.discards.slice(-18).forEach((tile) => container.append(createTile(tile, "discard")));
}

function renderLastDiscard() {
  els.lastDiscardSlot.innerHTML = "";
  if (state.lastDiscard) {
    els.lastDiscardSlot.append(createTile(state.lastDiscard.tile));
  }
}

function createTile(tileId, sizeClass = "") {
  const def = TILE_LOOKUP[tileId];
  const tile = els.tileTemplate.content.firstElementChild.cloneNode(true);
  tile.dataset.suit = def.suit;
  if (sizeClass) tile.classList.add(sizeClass);
  const rank = tile.querySelector(".tile-rank");
  const name = tile.querySelector(".tile-name");
  if (def.suit === "dot") {
    rank.replaceWith(createDotArt(def.rank));
    name.textContent = "";
  } else if (def.suit === "bamboo") {
    rank.replaceWith(createBambooArt(def.rank));
    name.textContent = "";
  } else if (def.suit === "character") {
    rank.classList.add("character-mark");
    rank.innerHTML = `<span>${def.glyph}</span><span>萬</span>`;
    name.textContent = "";
  } else {
    rank.classList.add("honor-mark");
    rank.textContent = def.glyph;
    name.textContent = def.label;
  }
  tile.title = tileText(tileId);
  return tile;
}

function createDotArt(rank) {
  const art = document.createElement("span");
  art.className = `tile-art dot-art rank-${rank}`;
  for (let index = 0; index < rank; index += 1) {
    const dot = document.createElement("span");
    dot.className = "pip";
    art.append(dot);
  }
  return art;
}

function createBambooArt(rank) {
  const art = document.createElement("span");
  art.className = `tile-art bamboo-art rank-${rank}`;
  for (let index = 0; index < rank; index += 1) {
    const bamboo = document.createElement("span");
    bamboo.className = "bamboo-stick";
    art.append(bamboo);
  }
  return art;
}

function createTileBack() {
  const tile = document.createElement("span");
  tile.className = "tile back";
  tile.setAttribute("aria-label", "Hidden tile");
  return tile;
}

function setStatus(title, text) {
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = message;
  els.logList.prepend(item);
}

function tileText(tileId) {
  const def = TILE_LOOKUP[tileId];
  if (def.suit === "wind") return `${def.label} wind`;
  if (def.suit.startsWith("dragon")) return `${def.label} dragon`;
  return `${def.rank} ${def.label}`;
}

function tileShort(tileId) {
  const def = TILE_LOOKUP[tileId];
  return `${def.rank}${def.label[0]}`;
}

async function createOnlineRoom() {
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) throw new Error("Room server is not running.");
    const data = await response.json();
    const origin = window.location.origin;
    const eastUrl = `${origin}${data.eastUrl}`;
    const westUrl = `${origin}${data.westUrl}`;
    els.roomCodeInput.value = data.room;
    els.roomStatus.textContent = `Room ${data.room} is ready. Open East for you and send West to your friend.`;
    els.roomLinks.innerHTML = `
      <a href="${eastUrl}">East player link</a>
      <a href="${westUrl}">West friend link</a>
    `;
  } catch (error) {
    els.roomStatus.textContent = "Start the room server first: node server.js";
  }
}

function joinOnlineRoom(seat) {
  const code = els.roomCodeInput.value.trim().toUpperCase();
  if (!code) return;
  window.location.href = `/?room=${encodeURIComponent(code)}&seat=${seat}`;
}

async function initOnlineRoom() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (!room) {
    startGame();
    return;
  }
  online.enabled = true;
  online.room = room.toUpperCase();
  online.seat = Number(params.get("seat") || 0);
  els.roomCodeInput.value = online.room;
  els.roomStatus.textContent = `Online room ${online.room}. You are ${online.seat === 2 ? "West / Friend" : "East / You"}.`;
  await fetchRoom();
  online.polling = window.setInterval(fetchRoom, 1000);
}

async function fetchRoom() {
  try {
    const response = await fetch(`/api/rooms/${online.room}?seat=${online.seat}`);
    if (!response.ok) throw new Error("Room not found.");
    applySnapshot(await response.json());
  } catch (error) {
    els.roomStatus.textContent = "Could not reach the room server.";
  }
}

async function postAction(action) {
  if (!online.enabled) return;
  try {
    const response = await fetch(`/api/rooms/${online.room}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, seat: online.seat }),
    });
    if (response.ok) applySnapshot(await response.json());
  } catch (error) {
    els.roomStatus.textContent = "Could not send that move to the room.";
  }
}

function applySnapshot(snapshot) {
  state.players = snapshot.players;
  state.wall = Array.from({ length: snapshot.wallCount }, () => null);
  state.current = snapshot.current;
  state.drawn = snapshot.drawn;
  state.lastDiscard = snapshot.lastDiscard;
  state.pendingCalls = snapshot.pendingCall ? [snapshot.pendingCall] : [];
  state.gameOver = snapshot.gameOver;
  els.callPanel.classList.add("hidden");
  els.passButton.classList.add("hidden");
  render();
  els.logList.innerHTML = "";
  snapshot.log.forEach((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    els.logList.append(item);
  });
  if (snapshot.pendingCall) {
    showCallPanel(snapshot.pendingCall.playerIndex, snapshot.pendingCall.options);
    setStatus(`${snapshot.players[snapshot.pendingCall.playerIndex].name} may call`, `Claim ${tileText(snapshot.lastDiscard.tile)} or pass.`);
  }
  if (snapshot.gameOver && snapshot.winner) {
    setStatus("Hand ended", snapshot.winner.message);
  }
}

els.drawButton.addEventListener("click", drawForCurrent);
els.winButton.addEventListener("click", declareWin);
els.passButton.addEventListener("click", passCall);
els.newGameButton.addEventListener("click", () => {
  if (online.enabled) postAction({ type: "newGame" });
  else startGame();
});
els.createRoomButton.addEventListener("click", createOnlineRoom);
els.joinEastButton.addEventListener("click", () => joinOnlineRoom(0));
els.joinWestButton.addEventListener("click", () => joinOnlineRoom(2));

initOnlineRoom();
