import { sessions } from "./db.js";

// Read the JSON body. Returns { body } or { error } with a 400 response.
export async function checkBody(c) {
    let body;
    try {
        body = await c.req.json();
    } catch {
        return { error: c.json({ error: "Body must be valid JSON" }, 400) };
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { error: c.json({ error: "Body must be a JSON object" }, 400) };
    }
    return { body };
}

// Like checkBody, but an empty body is allowed and becomes {}
export async function checkOptionalBody(c) {
    const text = await c.req.text();
    if (text.trim() === "") {
        return { body: {} };
    }
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        return { error: c.json({ error: "Body must be valid JSON" }, 400) };
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { error: c.json({ error: "Body must be a JSON object" }, 400) };
    }
    return { body };
}

// Validate { email, password } from a signup or login body.
// Returns { email, password } or { error } with a 400 response.
export function checkAccount(c, body) {
    if (typeof body.email !== "string" || typeof body.password !== "string") {
        return { error: c.json({ error: "Email and password are required" }, 400) };
    }
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    if (!email.includes("@")) {
        return { error: c.json({ error: "Email is not valid" }, 400) };
    }
    if (password.length < 6) {
        return { error: c.json({ error: "Password must be at least 6 characters" }, 400) };
    }
    return { email, password };
}

// The SvelteKit server sends the session token as "Authorization: Bearer <token>"
export function getToken(c) {
    const header = c.req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
        return null;
    }
    const token = header.slice("Bearer ".length).trim();
    return token === "" ? null : token;
}

// The logged-in user as { id, email }, or null if there is no valid session
export async function getCurrentUser(c) {
    const token = getToken(c);
    if (!token) {
        return null;
    }
    const session = await sessions.findOne({ token, expiresAt: { $gt: new Date() } });
    if (!session) {
        return null;
    }
    return { id: session.userId, email: session.email };
}