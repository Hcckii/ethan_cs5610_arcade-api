import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { users, sessions } from "../db.js";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { checkBody, checkAccount, getCurrentUser } from "../sharedFunction.js";

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

authApp.post("/logout", async (c)=>{
    const token = getCookie(c, "session");
    if(token){
        await sessions.deleteOne({token});
    }
    deleteCookie(c, "session", {path:"/"});
    return c.json({message:"You have logged out"}, 200);
});

authApp.get("/me", async (c) => {
    const userId = await getCurrentUser(c);
    if (!userId) {
      return c.json({ error: "You have not logged in" }, 401);
    }
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return c.json({ error: "You have not logged in" }, 401);
    }
    return c.json({ id: user._id, email: user.email }, 200);
});
export default authApp;