import { serve } from "@hono/node-server";
import { Hono } from "hono";
import gamesApp from "./routes/games.js";
import authApp from "./routes/auth.js";
const app = new Hono();

app.get("/", (c) => {
  return c.text("arcade-api is running", 200);
});

app.route("/games", gamesApp);
app.route("/auth", authApp);
// app.get("/test-core", (c) => {
//   return c.json(battleship.createGame(), 200);
// });

// app.post("/test-db", async (c) => {
//     const result = await games.insertOne(battleship.createGame());
//     return c.json({ id: result.insertedId }, 201);
// });
  
// app.get("/test-db", async (c) => {
//     const all = await games.find().toArray();
//     return c.json(all, 200);
// });

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

