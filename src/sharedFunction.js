import { getCookie } from "hono/cookie";
import { sessions } from "./db.js";
export async function checkBody(c) {
    try {
      const body = await c.req.json();
      if (body === null || typeof body !== "object") {
        return { error: c.json({ error: "Body must be a JSON object" }, 400) };
      }
      return { body };
    } catch {
      return { error: c.json({ error: "Invalid JSON" }, 400) };
    }
}

export function checkAccount(c, body){
    if (typeof body.email !== "string" || typeof body.password !== "string") {
        return {error:c.json({ error: "Email and password are required" }, 400)};
    }
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    if (email === "" || password === "") {
        return {error:c.json({ error: "Email and password are required" }, 400)};
    }
    return {email, password};
}

export async function getCurrentUser(c){
    const token = getCookie(c, "session");
    if(!token){
        return null;
    }
    const session = await sessions.findOne({token, expiresAt:{$gt:new Date()}});
    if(!session){
        return null;
    }
    return session.userId;
}