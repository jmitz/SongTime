const crypto = require("crypto");

function createAuth(password = process.env.ADMIN_PASSWORD || "") {
  const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
  const secret = crypto.randomBytes(32);
  const cookieName = "songlist_admin";
  const lifetime = 12 * 60 * 60;
  const digest = (value) => crypto.createHash("sha256").update(value).digest();
  const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
  const sign = (value) => crypto.createHmac("sha256", secret).update(value).digest("hex");

  function sameOrigin(req) {
    if (!req.headers.origin) return false;
    try {
      const origin = new URL(req.headers.origin);
      const protocol = req.socket?.encrypted ? "https" : "http";
      return ["http:", "https:"].includes(origin.protocol) &&
        origin.origin === (publicOrigin || `${protocol}://${req.headers.host}`);
    } catch {
      return false;
    }
  }

  function hasPassword(req) {
    const header = req.headers.authorization || "";
    if (!password || !header.startsWith("Basic ")) return false;
    const credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
    return equal(credentials, `admin:${password}`);
  }

  function hasSession(req) {
    if (!password) return false;
    const cookie = (req.headers.cookie || "").split(";")
      .map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
    if (!cookie) return false;
    const [expires, signature = ""] = cookie.slice(cookieName.length + 1).split(".");
    return /^\d+$/.test(expires) && Number(expires) > Date.now() && equal(signature, sign(expires));
  }

  function isAdmin(req) {
    return hasPassword(req) || hasSession(req);
  }

  function requireAdmin(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!password) {
      return res.status(503).send("Administrator access is disabled. Set ADMIN_PASSWORD and restart the server.");
    }
    const passwordValid = hasPassword(req);
    if (!passwordValid && !hasSession(req)) {
      res.set("WWW-Authenticate", 'Basic realm="SongList admin", charset="UTF-8"');
      return res.status(401).send("Administrator sign-in required.");
    }
    if (!["GET", "HEAD"].includes(req.method) &&
        ((req.headers.origin && !sameOrigin(req)) || (!passwordValid && !sameOrigin(req)))) {
      return res.status(403).json({ error: "A same-origin administrator request is required." });
    }
    if (passwordValid) {
      const expires = String(Date.now() + lifetime * 1000);
      res.cookie(cookieName, `${expires}.${sign(expires)}`, {
        httpOnly: true, sameSite: "strict", secure: req.secure || publicOrigin?.startsWith("https:"),
        maxAge: lifetime * 1000, path: "/",
      });
    }
    next();
  }

  return { requireAdmin, isAdmin, sameOrigin };
}

module.exports = { createAuth };
