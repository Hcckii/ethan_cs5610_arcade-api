import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { users, sessions } from "../db.js";
import { checkBody, checkAccount, getToken, getCurrentUser } from "../sharedFunction.js";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const authApp = new Hono();

// POST /api/auth/signup: create an account with an email and password
authApp.post("/signup", async (c) => {
    const { body, error: bodyError } = await checkBody(c);
    if (bodyError) {
        return bodyError;
    }
    const { email, password, error: accError } = checkAccount(c, body);
    if (accError) {
        return accError;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let result;
    try {
        result = await users.insertOne({ email, passwordHash, createdAt: new Date() });
    } catch (err) {
        if (err.code === 11000) {
            return c.json({ error: "Email already registered" }, 409);
        }
        throw err;
    }

    return c.json({ id: result.insertedId.toString(), email }, 201);
});

// POST /api/auth/login: check the email and password, start a session.
// The token is returned in the body; the SvelteKit server stores it in its own cookie.
authApp.post("/login", async (c) => {
    const { body, error: bodyError } = await checkBody(c);
    if (bodyError) {
        return bodyError;
    }
    const { email, password, error: accError } = checkAccount(c, body);
    if (accError) {
        return accError;
    }

    const user = await users.findOne({ email });
    if (!user) {
        return c.json({ error: "Invalid email or password" }, 401);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
        return c.json({ error: "Invalid email or password" }, 401);
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await sessions.insertOne({ token, userId: user._id.toString(), email: user.email, expiresAt });

    return c.json({ token, expiresAt, user: { id: user._id.toString(), email: user.email } }, 200);
});

// POST /api/auth/logout: end the current session. Always succeeds.
authApp.post("/logout", async (c) => {
    const token = getToken(c);
    if (token) {
        await sessions.deleteOne({ token });
    }
    return c.json({ message: "Logged out" }, 200);
});

// GET /api/auth/me: the logged-in user, or 401
authApp.get("/me", async (c) => {
    const user = await getCurrentUser(c);
    if (!user) {
        return c.json({ error: "Not logged in" }, 401);
    }
    return c.json(user, 200);
});

export default authApp;