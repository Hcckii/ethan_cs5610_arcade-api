import { serve } from "@hono/node-server";
import { Hono } from "hono";
import authApp from "./routes/auth.js";
import gamesApp from "./routes/games.js";

const app = new Hono();

app.get("/", (c) => {
    return c.text("arcade-api is running", 200);
});

app.route("/api/auth", authApp);
app.route("/api/games", gamesApp);

// Any path that doesn't match a route
app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
});

// Fallback for any error a route didn't handle itself
app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong on the server" }, 500);
});

// Render sets PORT; locally we use 3000
const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Server running at http://localhost:${info.port}`);
});