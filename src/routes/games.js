import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { battleship } from "@ethanhua/arcade-core";
import { games, users } from "../db.js";
import { checkBody, checkOptionalBody, getCurrentUser } from "../sharedFunction.js";
import { AI_PLAYER, isAiPlayer, createAiQueue, nextAiShot } from "../ai.js";

const gamesApp = new Hono();

//==================== Helpers ====================

// A game document in MongoDB:
// {
//   status: "waiting" | "placing" | "playing" | "finished",
//   ready: { p1: boolean, p2: boolean },  // true once a player has confirmed their fleet
//   players: { p1: { id, email }, p2: { id, email } | null },
//   boards: { p1: board, p2: board },   // each player's own fleet, with the opponent's shots on it
//   turn: "p1" | "p2",
//   winner: null | "p1" | "p2",
//   moves: number,                      // goes up by one on every shot, used to reject stale writes
//   aiQueue: [[x, y], ...]              // only in games against the AI: the squares it will fire at next
//   forfeitedBy: null | "p1" | "p2",    // set when a player leaves a game in progress
//   createdAt, updatedAt
// }

function otherPlayer(player) {
    return player === "p1" ? "p2" : "p1";
}

//==================== Active game limit ====================
// Each user can be in at most MAX_ACTIVE_GAMES games that are waiting or playing.
// users.activeGames counts them. Checking and adding happen in one updateOne,
// so two requests at the same time can't both get the last slot.

const MAX_ACTIVE_GAMES = 2;

async function takeSlot(userId) {
    const result = await users.updateOne(
        {
            _id: new ObjectId(userId),
            $or: [{ activeGames: { $lt: MAX_ACTIVE_GAMES } }, { activeGames: { $exists: false } }],
        },
        { $inc: { activeGames: 1 } }
    );
    return result.matchedCount === 1;
}

async function releaseSlot(userId) {
    await users.updateOne({ _id: new ObjectId(userId), activeGames: { $gt: 0 } }, { $inc: { activeGames: -1 } });
}

// When a game ends (finished, forfeited or deleted), both human players get their slot back
async function releaseSlots(game) {
    for (const player of [game.players.p1, game.players.p2]) {
        if (player !== null && !isAiPlayer(player)) {
            await releaseSlot(player.id);
        }
    }
}

const LIMIT_MESSAGE = `You can be in at most ${MAX_ACTIVE_GAMES} games at a time. Finish or leave one first`;

function getPlayerID(game, userId) {
    if (game.players.p1.id === userId) {
        return "p1";
    }
    if (game.players.p2 !== null && game.players.p2.id === userId) {
        return "p2";
    }
    return null;
}

// Load the game from the :id in the path. Returns { game } or { error } with a 404 response.
async function loadGame(c) {
    const id = c.req.param("id");
    if (!ObjectId.isValid(id)) {
        return { error: c.json({ error: "Game not found" }, 404) };
    }
    const game = await games.findOne({ _id: new ObjectId(id) });
    if (!game) {
        return { error: c.json({ error: "Game not found" }, 404) };
    }
    return { game };
}

function playerEmails(game) {
    return {
        p1: game.players.p1.email,
        p2: game.players.p2 === null ? null : game.players.p2.email,
    };
}

// The five ships on a board as [{ name, x, y, direction }], so the frontend can start
// the placement screen from the random layout the server made
function fleetFromBoard(board) {
    return battleship.SHIP_NAMES.map((name) => {
        const cells = [];
        board.forEach((row, y) => row.forEach((cell, x) => cell.ship === name && cells.push([x, y])));
        const x = Math.min(...cells.map(([cx]) => cx));
        const y = Math.min(...cells.map(([, cy]) => cy));
        const direction = cells.every(([, cy]) => cy === y) ? "horizontal" : "vertical";
        return { name, x, y, direction };
    });
}

// A short summary for the game list. Never includes boards.
function toListItem(game) {
    return {
        id: game._id.toString(),
        status: game.status,
        players: playerEmails(game),
        vsAi: isAiPlayer(game.players.p2),
        turn: game.turn,
        winner: game.winner,
        createdAt: game.createdAt,
    };
}

// One game as one viewer is allowed to see it.
// viewer is "p1" or "p2" for a player, or null for a spectator of a finished game.
function toGameView(game, viewer) {
    const base = {
        id: game._id.toString(),
        status: game.status,
        players: playerEmails(game),
        vsAi: isAiPlayer(game.players.p2),
        turn: game.turn,
        winner: game.winner,
        forfeitedBy: game.forfeitedBy ?? null,
        you: viewer,
    };

    if (viewer === null) {
        // The game is over, so nothing is hidden anymore
        return {
            ...base,
            boards: { p1: game.boards.p1, p2: game.boards.p2 },
            sunk: { p1: battleship.getSunkShips(game.boards.p1), p2: battleship.getSunkShips(game.boards.p2) },
        };
    }

    const enemy = otherPlayer(viewer);
    return {
        ...base,
        ready: { you: game.ready[viewer], opponent: game.ready[enemy] },
        myFleet: fleetFromBoard(game.boards[viewer]),
        myBoard: game.boards[viewer],
        // The opponent's ships are left out, except the ones that are already sunk
        opponentBoard: battleship.hideShips(game.boards[enemy]),
        mySunk: battleship.getSunkShips(game.boards[viewer]),
        opponentSunk: battleship.getSunkShips(game.boards[enemy]),
    };
}

//==================== GET /api/games ====================
// The games waiting for a second player, and the games the user is playing in (finished ones included)

gamesApp.get("/", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }

    // Leave the boards out at the database level
    const options = { projection: { status: 1, players: 1, turn: 1, winner: 1, createdAt: 1 } }; // no boards, no aiQueue

    const [waiting, mine] = await Promise.all([
        games
            .find({ status: "waiting", "players.p1.id": { $ne: user.id } }, options)
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray(),
        games
            .find({ $or: [{ "players.p1.id": user.id }, { "players.p2.id": user.id }] }, options)
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray(),
    ]);

    return c.json({ waiting: waiting.map(toListItem), mine: mine.map(toListItem) }, 200);
});

//==================== POST /api/games ====================
// Create a new game, with both fleets placed randomly.
// Players can keep that layout or place their own ships with POST /api/games/:id/ships.

gamesApp.post("/", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }

    const now = new Date();
    const game = {
        status: "waiting",
        players: { p1: { id: user.id, email: user.email }, p2: null },
        boards: { p1: battleship.createRandomBoard(), p2: battleship.createRandomBoard() },
        ready: { p1: false, p2: false },
        turn: "p1",
        winner: null,
        moves: 0,
        forfeitedBy: null,
        createdAt: now,
        updatedAt: now,
    };

    if (!(await takeSlot(user.id))) {
        return c.json({ error: LIMIT_MESSAGE }, 409);
    }
    // insertOne adds the new _id to the game object
    try {
        await games.insertOne(game);
    } catch (err) {
        await releaseSlot(user.id); // the game wasn't created, so give the slot back
        throw err;
    }
    return c.json(toGameView(game, "p1"), 201);
});

//==================== GET /api/games/:id ====================
// One game, with the opponent's ships left out.
// Logged-out visitors and non-players can only see a game after it is over.

gamesApp.get("/:id", async (c) => {
    const { game, error } = await loadGame(c);
    if (error) {
        return error;
    }

    const user = await getCurrentUser(c);
    if (!user) {
        if (game.status === "finished") {
            return c.json(toGameView(game, null), 200);
        }
        return c.json({ error: "Log in to view a game that is not over yet" }, 401);
    }

    const player = getPlayerID(game, user.id);
    if (player !== null) {
        return c.json(toGameView(game, player), 200);
    }
    if (game.status === "finished") {
        return c.json(toGameView(game, null), 200);
    }
    return c.json({ error: "You are not a player in this game" }, 403);
});

//==================== POST /api/games/:id/players ====================
// Join a waiting game as the second player.
// Body (optional): { "ai": true } lets the game's creator make the AI the second player instead.

gamesApp.post("/:id/players", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }
    const { game, error } = await loadGame(c);
    if (error) {
        return error;
    }
    const { body, error: bodyError } = await checkOptionalBody(c);
    if (bodyError) {
        return bodyError;
    }
    if (body.ai !== undefined && typeof body.ai !== "boolean") {
        return c.json({ error: "ai must be true or false" }, 400);
    }
    const withAi = body.ai === true;

    if (withAi && game.players.p1.id !== user.id) {
        return c.json({ error: "Only the player who created this game can challenge the AI" }, 403);
    }
    if (!withAi && game.players.p1.id === user.id) {
        return c.json({ error: "You cannot join your own game" }, 409);
    }
    if (game.status !== "waiting" || game.players.p2 !== null) {
        return c.json({ error: "This game is not waiting for a player" }, 409);
    }

    // Joining as a human uses one of your slots. Challenging the AI doesn't: you are already in this game.
    if (!withAi && !(await takeSlot(user.id))) {
        return c.json({ error: LIMIT_MESSAGE }, 409);
    }

    const p2 = withAi ? AI_PLAYER : { id: user.id, email: user.email };
    // The AI is ready right away with its random fleet; a human still has to place their ships
    const p2Ready = withAi;
    const status = game.ready.p1 && p2Ready ? "playing" : "placing";
    const changes = { "players.p2": p2, "ready.p2": p2Ready, status, updatedAt: new Date() };
    if (withAi) {
        changes.aiQueue = createAiQueue();
    }

    // The "players.p2": null condition makes sure two people can't join at the same time
    const result = await games.updateOne(
        { _id: game._id, status: "waiting", "players.p2": null },
        { $set: changes }
    );
    if (result.matchedCount === 0) {
        if (!withAi) {
            await releaseSlot(user.id); // someone else joined first, so give the slot back
        }
        return c.json({ error: "This game is not waiting for a player" }, 409);
    }

    const updated = {
        ...game,
        status,
        players: { ...game.players, p2 },
        ready: { ...game.ready, p2: p2Ready },
    };
    return c.json(toGameView(updated, withAi ? "p1" : "p2"), 201);
});

//==================== POST /api/games/:id/ships ====================
// Extra credit: place your own fleet. Body: { ships: [{ name, x, y, direction }, ...] } with all five ships.
// The server rebuilds the board from scratch with placeShip, so every placement is checked here.

gamesApp.post("/:id/ships", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }
    const { game, error } = await loadGame(c);
    if (error) {
        return error;
    }
    const player = getPlayerID(game, user.id);
    if (player === null) {
        return c.json({ error: "You are not a player in this game" }, 403);
    }

    const { body, error: bodyError } = await checkBody(c);
    if (bodyError) {
        return bodyError;
    }
    const ships = body.ships;
    if (!Array.isArray(ships) || ships.length !== battleship.SHIP_NAMES.length) {
        return c.json({ error: `ships must be an array of all ${battleship.SHIP_NAMES.length} ships` }, 400);
    }

    let board = battleship.createEmptyBoard();
    for (const ship of ships) {
        const next = battleship.placeShip(board, ship);
        if (next === null) {
            const name = typeof ship?.name === "string" ? ship.name : "a ship";
            return c.json({ error: `The placement of ${name} is not legal` }, 400);
        }
        board = next;
    }
    // Five legal placements with no duplicates means every ship is on the board exactly once

    if (game.status !== "waiting" && game.status !== "placing") {
        return c.json({ error: "Ships can't be moved once the game has started" }, 409);
    }
    if (game.ready[player]) {
        return c.json({ error: "You already confirmed your ships" }, 409);
    }

    const enemy = otherPlayer(player);
    const bothReady = game.players.p2 !== null && game.ready[enemy];
    const status = bothReady ? "playing" : game.status;
    const changes = {
        [`boards.${player}`]: board,
        [`ready.${player}`]: true,
        status,
        updatedAt: new Date(),
    };

    // moves in the filter: if the other player confirmed at the same moment, one of us retries
    const result = await games.updateOne(
        { _id: game._id, moves: game.moves, [`ready.${player}`]: false },
        { $set: changes, $inc: { moves: 1 } }
    );
    if (result.matchedCount === 0) {
        return c.json({ error: "The game changed. Refresh and try again" }, 409);
    }

    const updated = {
        ...game,
        boards: { ...game.boards, [player]: board },
        ready: { ...game.ready, [player]: true },
        status,
        moves: game.moves + 1,
    };
    return c.json(toGameView(updated, player), 201);
});

//==================== POST /api/games/:id/shots ====================
// Fire at a square on the opponent's board. Body: { x, y }

gamesApp.post("/:id/shots", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }
    const { game, error } = await loadGame(c);
    if (error) {
        return error;
    }
    const player = getPlayerID(game, user.id);
    if (player === null) {
        return c.json({ error: "You are not a player in this game" }, 403);
    }

    const { body, error: bodyError } = await checkBody(c);
    if (bodyError) {
        return bodyError;
    }
    const { x, y } = body;
    if (!battleship.isInBounds(x, y)) {
        return c.json({ error: "x and y must be integers from 0 to 9" }, 400);
    }

    if (game.status === "waiting") {
        return c.json({ error: "Waiting for a second player" }, 409);
    }
    if (game.status === "placing") {
        return c.json({ error: "Waiting for both players to place their ships" }, 409);
    }
    if (game.status === "finished") {
        return c.json({ error: "The game is over" }, 409);
    }
    if (game.turn !== player) {
        return c.json({ error: "It is not your turn" }, 409);
    }

    const enemy = otherPlayer(player);
    // x and y are already known to be in bounds, so an invalid shot here means a repeat
    if (!battleship.isValidShot(game.boards[enemy], x, y)) {
        return c.json({ error: "You already fired at that square" }, 409);
    }

    const shot = applyShot(game.boards[enemy], x, y);
    const boards = { ...game.boards, [enemy]: shot.board };
    let status = shot.over ? "finished" : "playing";
    let turn = shot.over ? player : enemy;
    let winner = shot.over ? player : null;
    const changes = { [`boards.${enemy}`]: shot.board };

    // Against the AI, it fires back right away in the same request.
    // The human is always p1 in an AI game, so the AI fires at boards.p1.
    let aiShot = null;
    if (!shot.over && isAiPlayer(game.players.p2)) {
        const next = nextAiShot(boards.p1, game.aiQueue);
        if (next !== null) {
            const reply = applyShot(boards.p1, next.x, next.y);
            boards.p1 = reply.board;
            changes["boards.p1"] = reply.board;
            changes.aiQueue = next.queue;
            aiShot = { x: next.x, y: next.y, hit: reply.hit, sunk: reply.sunk };
            status = reply.over ? "finished" : "playing";
            turn = "p1";
            winner = reply.over ? "p2" : null;
        }
    }

    Object.assign(changes, { status, turn, winner, updatedAt: new Date() });

    // Only write if nobody else changed the game since we read it (for example, a double click)
    const result = await games.updateOne({ _id: game._id, moves: game.moves }, { $set: changes, $inc: { moves: 1 } });
    if (result.matchedCount === 0) {
        return c.json({ error: "The game changed. Refresh and try again" }, 409);
    }

    if (status === "finished") {
        await releaseSlots(game);
    }

    const updated = { ...game, boards, status, turn, winner, moves: game.moves + 1 };
    return c.json(
        { hit: shot.hit, sunk: shot.sunk, gameOver: status === "finished", aiShot, game: toGameView(updated, player) },
        201
    );
});

//==================== DELETE /api/games/:id/players/me ====================
// Leave a game.
// - Waiting for a second player: nobody else is affected, so the game is deleted.
// - Placing ships or in progress: the player forfeits, the opponent wins, and the game is finished.

gamesApp.delete("/:id/players/me", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }
    const { game, error } = await loadGame(c);
    if (error) {
        return error;
    }
    const player = getPlayerID(game, user.id);
    if (player === null) {
        return c.json({ error: "You are not a player in this game" }, 403);
    }
    if (game.status === "finished") {
        return c.json({ error: "The game is already over" }, 409);
    }

    if (game.status === "waiting") {
        // status: "waiting" in the filter: if someone joined a moment ago, don't delete their game
        const result = await games.deleteOne({ _id: game._id, status: "waiting" });
        if (result.deletedCount === 0) {
            return c.json({ error: "The game changed. Refresh and try again" }, 409);
        }
        await releaseSlots(game);
        return c.json({ deleted: true, game: null }, 200);
    }

    const winner = otherPlayer(player);
    const changes = {
        status: "finished",
        winner,
        turn: winner,
        forfeitedBy: player,
        updatedAt: new Date(),
    };
    const result = await games.updateOne(
        { _id: game._id, status: game.status, moves: game.moves },
        { $set: changes, $inc: { moves: 1 } }
    );
    if (result.matchedCount === 0) {
        return c.json({ error: "The game changed. Refresh and try again" }, 409);
    }
    await releaseSlots(game);

    const updated = { ...game, ...changes, moves: game.moves + 1 };
    return c.json({ deleted: false, game: toGameView(updated, player) }, 200);
});

// Record a shot that is already known to be valid. Returns the new board and what happened.
function applyShot(board, x, y) {
    const newBoard = battleship.updateBoard(board, x, y);
    const cell = newBoard[y][x];
    const hit = cell.shot === "hit";
    return {
        board: newBoard,
        hit,
        sunk: hit && battleship.isShipSunk(newBoard, cell.ship) ? cell.ship : null,
        over: battleship.isGameComplete(newBoard),
    };
}

export default gamesApp;