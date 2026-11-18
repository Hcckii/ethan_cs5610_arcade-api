import { Hono } from "hono";
import { battleship } from "@ethanhua/arcade-core";
import { games } from "../db.js";
import { ObjectId } from "mongodb";

const gamesApp = new Hono();

gamesApp.post("/", async (c)=>{
    const userId = c.req.header("x-user");
    if(!userId){
        return c.json({error:"Not logged in"}, 401);
    }
    const game = battleship.createGame();
    const newGame = {
        ...game,
        users:{p1:userId, p2:null}
    };
    const result = await games.insertOne(newGame);
    return c.json({id:result.insertedId}, 201);
})

gamesApp.get("/:id", async (c)=>{
    const userId = c.req.header("x-user");
    if(!userId){
        return c.json({error:"Not logged in"}, 401);
    }
    const id = c.req.param("id");
    if(!ObjectId.isValid(id)){
        return c.json({error:"Invalid ID"}, 404);
    }
    const game = await games.findOne({_id:new ObjectId(id)});
    if(!game){
        return c.json({error:"Game not found"}, 404);
    }
    let player;
    if(game.users.p1===userId){
        player = "p1";
    }else if(game.users.p2===userId){
        player = "p2";
    }else{
        return c.json({error:"You are not the player of this game"}, 403);
    }
    return c.json(battleship.getPlayerView(game, player), 200);
});

export default gamesApp;