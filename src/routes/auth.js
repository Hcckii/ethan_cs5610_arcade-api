import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { setCookie } from "hono/cookie";
import { users, sessions } from "../db.js";
import bcrypt from "bcryptjs";
import { checkBody, checkAccount } from "../sharedFunction.js";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const authApp = new Hono();

authApp.post("/signup", async (c) => {
    const { body, error: bodyError } = await checkBody(c);
    if (bodyError) {
      return bodyError;
    }
    const { email, password, error:accError } = checkAccount(c, body);
    if(accError){
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
  
    return c.json({ id: result.insertedId, email }, 201);
});

authApp.post("/login", async (c)=>{
    const { body, error:bodyError } = await checkBody(c);
    if(bodyError){
        return bodyError;
    }
    const {email, password, error:accError} = checkAccount(c, body);
    if(accError){
        return accError;
    }
    const user = await users.findOne({email});
    if(!user){
        return c.json({error:"Invalid email or password"}, 401);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if(!ok){
        return c.json({error:"Invalid email or password"}, 401);
    }
    const token = randomBytes(32).toString("hex");
    await sessions.insertOne({
        token,
        userId:user._id.toString(),
        expiresAt: new Date(Date.now()+SESSION_MS)
    });

    setCookie(c, "session", token, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_MS / 1000
    });
    return c.json({userId:user._id.toString(), email}, 200);
})

export default authApp;