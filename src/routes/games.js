import { Hono } from "hono";
import { battleship } from "@ethanhua/arcade-core";
import { games } from "../db.js";
import { ObjectId } from "mongodb";
import { checkBody, getCurrentUser } from "../sharedFunction.js";

const gamesApp = new Hono();

gamesApp.post("/", async (c) => {
    const userId = await getCurrentUser(c);
    if (!userId) {
      return c.json({ error: "Not logged in" }, 401);
    }
    const game = battleship.createGame();
    const newGame = { ...game, users: { p1: userId, p2: null } };
    const result = await games.insertOne(newGame);
    return c.json({ id: result.insertedId }, 201);
});

gamesApp.post("/:id/players", async(c)=>{
    const {game, userId, error} = await loadPlayerGame(c);
    if(error){
        return error;
    }
    if(game.users.p1===userId){
        return c.json({error:"You cannot join your own game"}, 409);
    }
    if (game.users.p2 !== null) {
        return c.json({ error: "The game is full" }, 409);
    }
    const result = await games.updateOne({_id:game._id, "users.p2":null}, {$set:{"users.p2":userId}});
    if(result.matchedCount===0){
        return c.json({error:"The game is full"}, 409);
    }
    const updated = {...game, users:{...game.users, p2:userId}};
    const p2Game = battleship.getPlayerView(updated, "p2");
    return c.json(p2Game, 201);
});

gamesApp.post("/:id/players/me", async (c)=>{
    const {game, userId, error} = await loadPlayerGame(c);
    if(error){
        return error;
    }
    const player = getPlayerID(game, userId);
    if(!player){
        return c.json({error:"You are not the player of this game"}, 403);
    }
    const result = battleship.confirmReady(game, player);
    if(result.error){
        return c.json({error:result.error}, 409);
    }
    await saveGame(result.game);
    return c.json(battleship.getPlayerView(result.game, player), 200);
});


gamesApp.get("/:id", async (c) => {
    const { game, userId, error } = await loadPlayerGame(c);
    if (error) {
      return error;
    }
    const player = getPlayerID(game, userId);
    if (player === null) {
      return c.json({ error: "You are not the player of this game" }, 403);
    }
    return c.json(battleship.getPlayerView(game, player), 200);
});

function getPlayerID(game, userId) {
    if (game.users.p1 === userId) {
        return "p1";
    }
    if (game.users.p2 === userId) {
        return "p2";
    }
    return null;
}

async function loadPlayerGame(c) {
    const userId = await getCurrentUser(c);
    if (!userId) {
      return { error: c.json({ error: "Not logged in" }, 401) };
    }
    const id = c.req.param("id");
    if (!ObjectId.isValid(id)) {
      return { error: c.json({ error: "Game not found" }, 404) };
    }
    const game = await games.findOne({ _id: new ObjectId(id) });
    if (!game) {
      return { error: c.json({ error: "Game not found" }, 404) };
    }
    return { game, userId };
}

async function saveGame(game) {
    await games.updateOne(
      { _id: game._id },
      { $set: { phase: game.phase, turn: game.turn, winner: game.winner, players: game.players } }
    );
}

//==================== Ships =======================
gamesApp.post("/:id/ships/random", async (c) => {
    const { game, userId, error } = await loadPlayerGame(c);
    if (error) {
      return error;
    }
    const player = getPlayerID(game, userId);
    if (!player) {
      return c.json({ error: "You are not the player of this game" }, 403);
    }
    const result = battleship.randomPlacement(game, player);
    if (result.error) {
      return c.json({ error: result.error }, 409);
    }
    await saveGame(result.game);
    return c.json(battleship.getPlayerView(result.game, player), 200);
});

gamesApp.put("/:id/ships/:type", async (c)=>{
    const {game, userId, error} = await loadPlayerGame(c);
    if(error){
        return error;
    }
    const player = getPlayerID(game, userId);
    if(!player){
        return c.json({error:"You are not the player of this game"}, 403);
    }
    const {body, error:bderror} = await checkBody(c);
    if(bderror){
        return bderror;
    }
    const ship = {...body, "type":c.req.param("type")};
    const result = battleship.placeShip(game, player, ship);
    if(result.error){
        const status = result.error==="Invalid ship"?400:409;
        return c.json({error:result.error}, status);
    }
    await saveGame(result.game);
    return c.json({placed:result.placed, view:battleship.getPlayerView(result.game, player)}, 200);
});

gamesApp.post("/:id/shots", async(c)=>{
    const {game, userId, error:loadError} = await loadPlayerGame(c);
    if(loadError){
        return loadError;
    }
    const player = getPlayerID(game, userId);
    if(!player){
        return c.json({error:"You are not the player of this game"}, 403);
    }
    const {body, error:bdError} = await checkBody(c);
    if(bdError){
        return bdError;
    }
    const {row, col} = body;
    const coord = [row, col];
    const result = battleship.fire(game, player, coord);
    if (result.error) {
        const status = result.error === "Invalid coord" ? 400 : 409;
        return c.json({ error: result.error }, status);
    }
    await saveGame(result.game);
    return c.json(
        {
            hit:result.hit,
            sunk:result.sunk,
            ship:result.hit?battleship.allShips[result.shipID-1]:null,
            view:battleship.getPlayerView(result.game, player)
        }
        , 201);
});

export default gamesApp;