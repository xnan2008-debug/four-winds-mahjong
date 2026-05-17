const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const rooms = new Map();

const TILE_DEFS = [
  ...Array.from({ length: 9 }, (_, index) => ({ id: `b${index + 1}`, rank: index + 1, suit: "bamboo", label: "Bam" })),
  ...Array.from({ length: 9 }, (_, index) => ({ id: `c${index + 1}`, rank: index + 1, suit: "character", label: "Wan" })),
  ...Array.from({ length: 9 }, (_, index) => ({ id: `d${index + 1}`, rank: index + 1, suit: "dot", label: "Dot" })),
  { id: "we", rank: 1, suit: "wind", label: "East" },
  { id: "ws", rank: 2, suit: "wind", label: "South" },
  { id: "ww", rank: 3, suit: "wind", label: "West" },
  { id: "wn", rank: 4, suit: "wind", label: "North" },
  { id: "dr", rank: 1, suit: "dragon-red", label: "Red" },
  { id: "dg", rank: 2, suit: "dragon-green", label: "Green" },
  { id: "dw", rank: 3, suit: "dragon-white", label: "White" },
];
const TILE_LOOKUP = Object.fromEntries(TILE_DEFS.map((tile) => [tile.id, tile]));
const SEATS = [
  { name: "Black Widow", wind: "East", human: true },
  { name: "Hulk", wind: "South", human: false },
  { name: "Captain America", wind: "West", human: true },
  { name: "Ironman", wind: "North", human: false },
];

function buildWall() {
  const wall = [];
  TILE_DEFS.forEach((tile) => {
    for (let copy = 0; copy < 4; copy += 1) wall.push(tile.id);
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

function createRoom() {
  let id = "";
  do {
    id = Math.random().toString(36).slice(2, 7).toUpperCase();
  } while (rooms.has(id));
  const room = {
    id,
    version: 0,
    wall: buildWall(),
    players: SEATS.map((seat) => ({ ...seat, hand: [], melds: [], discards: [] })),
    current: 0,
    drawn: true,
    lastDiscard: null,
    pendingCalls: [],
    gameOver: false,
    log: [],
    winner: null,
  };
  for (let tile = 0; tile < 13; tile += 1) {
    room.players.forEach((player) => player.hand.push(drawTile(room)));
  }
  room.players[0].hand.push(drawTile(room));
  room.players.forEach((player) => sortHand(player.hand));
  addLog(room, "East begins with 14 tiles.");
  rooms.set(id, room);
  return room;
}

function resetRoom(room) {
  const fresh = createRoom();
  rooms.delete(fresh.id);
  fresh.id = room.id;
  rooms.set(room.id, fresh);
  return fresh;
}

function drawTile(room) {
  return room.wall.pop();
}

function sortHand(hand) {
  hand.sort((a, b) => tileIndex(a) - tileIndex(b));
}

function tileIndex(id) {
  return TILE_DEFS.findIndex((tile) => tile.id === id);
}

function currentPlayer(room) {
  return room.players[room.current];
}

function addLog(room, message) {
  room.log.unshift(message);
  room.log = room.log.slice(0, 80);
  room.version += 1;
}

function applyAction(room, seat, action) {
  if (room.gameOver) return;
  if (action.type === "newGame") {
    return resetRoom(room);
  }
  if (action.type === "pass") {
    const call = room.pendingCalls[0];
    if (call && call.playerIndex === seat) passCall(room);
    processNpc(room);
    return;
  }
  if (action.type === "call") {
    const call = room.pendingCalls[0];
    const option = call?.options[action.callIndex];
    if (call && call.playerIndex === seat && option) takeCall(room, seat, option);
    processNpc(room);
    return;
  }
  if (room.pendingCalls.length > 0 || room.current !== seat || !room.players[seat].human) return;
  if (action.type === "draw") drawForCurrent(room);
  if (action.type === "discard") discardTile(room, seat, Number(action.tileIndex));
  if (action.type === "win") declareWin(room, seat);
  processNpc(room);
}

function drawForCurrent(room) {
  if (room.drawn) return;
  const tile = drawTile(room);
  if (!tile) return endDraw(room);
  currentPlayer(room).hand.push(tile);
  sortHand(currentPlayer(room).hand);
  room.drawn = true;
  addLog(room, `${currentPlayer(room).name} draws.`);
}

function discardTile(room, playerIndex, handIndex) {
  const player = room.players[playerIndex];
  if (!room.drawn || handIndex < 0 || handIndex >= player.hand.length) return;
  const [tile] = player.hand.splice(handIndex, 1);
  player.discards.push(tile);
  room.lastDiscard = { tile, from: playerIndex };
  room.drawn = false;
  addLog(room, `${player.name} discards ${tileText(tile)}.`);
  gatherCalls(room, tile, playerIndex);
  if (room.pendingCalls.length === 0) advanceTurn(room);
}

function advanceTurn(room) {
  room.current = (room.current + 1) % room.players.length;
  room.drawn = false;
  room.lastDiscard = null;
  room.version += 1;
}

function gatherCalls(room, tile, fromIndex) {
  room.pendingCalls = [];
  room.players.forEach((player, index) => {
    if (index === fromIndex) return;
    const options = getCallOptions(player, index, tile, fromIndex);
    if (options.length > 0) room.pendingCalls.push({ playerIndex: index, options });
  });
  room.pendingCalls.sort((a, b) => {
    const priorityDifference = bestCallPriority(b.options) - bestCallPriority(a.options);
    if (priorityDifference !== 0) return priorityDifference;
    if (room.players[a.playerIndex].human !== room.players[b.playerIndex].human) {
      return room.players[a.playerIndex].human ? -1 : 1;
    }
    return turnDistance(room, fromIndex, a.playerIndex) - turnDistance(room, fromIndex, b.playerIndex);
  });
}

function getCallOptions(player, playerIndex, tile, fromIndex) {
  const options = [];
  if (isWinningHand([...player.hand, tile], player.melds.length)) options.push({ type: "win", label: "Win" });
  const count = player.hand.filter((item) => item === tile).length;
  if (count >= 3) options.push({ type: "kong", label: "Kong", tiles: [tile, tile, tile] });
  if (count >= 2) options.push({ type: "pong", label: "Pong", tiles: [tile, tile] });
  if (playerIndex === (fromIndex + 1) % 4) {
    getChowOptions(player.hand, tile).forEach((tiles) => options.push({ type: "chow", label: `Chow ${tiles.map(tileShort).join("-")}`, tiles }));
  }
  return options;
}

function getChowOptions(hand, tile) {
  const def = TILE_LOOKUP[tile];
  if (!["bamboo", "character", "dot"].includes(def.suit)) return [];
  const options = [];
  [-2, -1, 0].forEach((offset) => {
    const sequence = [def.rank + offset, def.rank + offset + 1, def.rank + offset + 2];
    if (!sequence.includes(def.rank) || sequence.some((rank) => rank < 1 || rank > 9)) return;
    const needed = sequence.filter((rank) => rank !== def.rank).map((rank) => `${tile[0]}${rank}`);
    if (needed.every((id) => hand.includes(id))) options.push(needed);
  });
  return options;
}

function passCall(room) {
  room.pendingCalls.shift();
  if (room.pendingCalls.length === 0) advanceTurn(room);
  else room.version += 1;
}

function takeCall(room, playerIndex, option) {
  const player = room.players[playerIndex];
  if (option.type === "win") {
    player.hand.push(room.lastDiscard.tile);
    sortHand(player.hand);
    return finishWin(room, playerIndex, `${player.name} wins on ${room.players[room.lastDiscard.from].name}'s discard.`);
  }
  removeLastDiscard(room);
  option.tiles.forEach((tile) => removeOne(player.hand, tile));
  player.melds.push({ type: option.type, tiles: [...option.tiles, room.lastDiscard.tile].sort((a, b) => tileIndex(a) - tileIndex(b)) });
  if (option.type === "kong") {
    const replacement = drawTile(room);
    if (!replacement) return endDraw(room);
    player.hand.push(replacement);
    addLog(room, `${player.name} draws a kong replacement.`);
  }
  room.current = playerIndex;
  room.drawn = true;
  room.pendingCalls = [];
  sortHand(player.hand);
  addLog(room, `${player.name} calls ${option.type}.`);
}

function removeLastDiscard(room) {
  room.players[room.lastDiscard.from].discards.pop();
}

function removeOne(hand, tile) {
  const index = hand.indexOf(tile);
  if (index >= 0) hand.splice(index, 1);
}

function processNpc(room) {
  let guard = 0;
  while (!room.gameOver && guard < 80) {
    guard += 1;
    const call = room.pendingCalls[0];
    if (call) {
      const player = room.players[call.playerIndex];
      if (player.human) return;
      const option = call.options.find((item) => item.type === "win" || item.type === "kong" || (item.type === "pong" && countPairs(player.hand) < 4) || (item.type === "chow" && Math.random() < 0.35));
      if (option) takeCall(room, call.playerIndex, option);
      else passCall(room);
      continue;
    }
    const player = currentPlayer(room);
    if (player.human) return;
    if (!room.drawn) {
      const tile = drawTile(room);
      if (!tile) return endDraw(room);
      player.hand.push(tile);
      sortHand(player.hand);
      room.drawn = true;
      addLog(room, `${player.name} draws.`);
    }
    if (isWinningHand(player.hand, player.melds.length)) return finishWin(room, room.current, `${player.name} wins by self-draw.`);
    discardTile(room, room.current, chooseNpcDiscard(player.hand));
  }
}

function chooseNpcDiscard(hand) {
  const counts = countTiles(hand);
  let bestIndex = 0;
  let bestScore = Infinity;
  hand.forEach((tile, index) => {
    const def = TILE_LOOKUP[tile];
    let score = counts[tile] * -8;
    if (["bamboo", "character", "dot"].includes(def.suit)) {
      score -= (counts[`${tile[0]}${def.rank - 1}`] || 0) * 3;
      score -= (counts[`${tile[0]}${def.rank + 1}`] || 0) * 3;
      score -= (counts[`${tile[0]}${def.rank - 2}`] || 0);
      score -= (counts[`${tile[0]}${def.rank + 2}`] || 0);
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

function declareWin(room, seat) {
  const player = room.players[seat];
  if (isWinningHand(player.hand, player.melds.length)) finishWin(room, seat, `${player.name} wins by self-draw.`);
}

function finishWin(room, playerIndex, message) {
  room.gameOver = true;
  room.pendingCalls = [];
  room.winner = { playerIndex, message };
  addLog(room, message);
}

function endDraw(room) {
  room.gameOver = true;
  room.winner = { playerIndex: null, message: "The hand ends in a draw." };
  addLog(room, "The hand ends in a draw.");
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
  return Object.values(countTiles(hand)).every((count) => count === 2);
}

function canMakeGroups(counts, groupsLeft) {
  if (groupsLeft === 0) return Object.values(counts).every((count) => count === 0);
  const tile = Object.keys(counts).filter((id) => counts[id] > 0).sort((a, b) => tileIndex(a) - tileIndex(b))[0];
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

function bestCallPriority(options) {
  return Math.max(...options.map(optionPriority));
}

function optionPriority(option) {
  if (option.type === "win") return 3;
  if (option.type === "pong" || option.type === "kong") return 2;
  return 1;
}

function turnDistance(room, fromIndex, playerIndex) {
  return (playerIndex - fromIndex + room.players.length) % room.players.length;
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

function snapshot(room, seat) {
  const pendingCall = room.gameOver ? null : room.pendingCalls[0];
  return {
    id: room.id,
    version: room.version,
    current: room.current,
    drawn: room.drawn,
    lastDiscard: room.lastDiscard,
    pendingCall: pendingCall && pendingCall.playerIndex === seat ? pendingCall : null,
    wallCount: room.wall.length,
    gameOver: room.gameOver,
    winner: room.winner,
    log: room.log,
    players: room.players.map((player, index) => ({
      name: player.name,
      wind: player.wind,
      human: player.human,
      melds: player.melds,
      discards: player.discards,
      hand: index === seat ? player.hand : Array.from({ length: player.hand.length }, () => null),
    })),
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const room = createRoom();
    return sendJson(res, 200, { room: room.id, eastUrl: `/?room=${room.id}&seat=0`, westUrl: `/?room=${room.id}&seat=2` });
  }
  const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
  if (match && req.method === "GET") {
    const room = rooms.get(match[1]);
    if (!room) return sendJson(res, 404, { error: "Room not found" });
    return sendJson(res, 200, snapshot(room, Number(url.searchParams.get("seat") || 0)));
  }
  const actionMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/actions$/);
  if (actionMatch && req.method === "POST") {
    const room = rooms.get(actionMatch[1]);
    if (!room) return sendJson(res, 404, { error: "Room not found" });
    const body = await readJson(req);
    const updatedRoom = applyAction(room, Number(body.seat), body) || rooms.get(actionMatch[1]);
    return sendJson(res, 200, snapshot(updatedRoom, Number(body.seat)));
  }
  return serveFile(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
  console.log(`Mahjong room server: http://localhost:${PORT}`);
  addresses.forEach((address) => console.log(`LAN link: ${address}`));
});
