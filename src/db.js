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
await users.createIndex({ email: 1 }, { unique: true }, {});
await sessions.createIndex({ token: 1 }, { unique: true }, {});
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }, {});