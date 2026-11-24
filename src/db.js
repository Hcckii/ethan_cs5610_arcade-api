import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Check your .env file.");
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

export const db = client.db("arcade");
export const games = db.collection("games");
export const users = db.collection("users");
export const sessions = db.collection("sessions");

// Email must be unique at the database level
await users.createIndex({ email: 1 }, { unique: true }, {});

// Sessions are looked up by token on every request; expired sessions are deleted automatically
await sessions.createIndex({ token: 1 }, { unique: true }, {});
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }, {});

// GET /api/games filters by status and by player
await games.createIndex({ status: 1, createdAt: -1 }, {}, {});
await games.createIndex({ "players.p1.id": 1 }, {}, {});
await games.createIndex({ "players.p2.id": 1 }, {}, {});