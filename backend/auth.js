const crypto = require("crypto");
const prisma = require("./db");
const config = require("./config");
const { sendJson, redirect, readBody } = require("./http");
const { saveOAuthAvatar } = require("./profile");
const { unlockAchievement } = require("./achievements");
const sessionSecret = config.sessionSecret;
const sessionCookieName = config.sessionCookieName;

function appendCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");

  if (!existing) {
    res.setHeader("Set-Cookie", [cookie]);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [existing, cookie]);
}

function setSessionCookie(res, token) {
  const cookieParts = [
    `${sessionCookieName}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];

  if (config.frontendUrl.startsWith("https://")) cookieParts.push("Secure");

  appendCookie(res, cookieParts.join("; "));
}

function clearSessionCookie(res) {
  const cookieParts = [
    `${sessionCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (config.frontendUrl.startsWith("https://")) cookieParts.push("Secure");

  appendCookie(res, cookieParts.join("; "));
}

function buildOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}

function setOAuthStateCookie(res, state) {
  const cookieParts = [
    `${config.oauthStateCookieName}=${state}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];

  if (config.frontendUrl.startsWith("https://")) cookieParts.push("Secure");

  appendCookie(res, cookieParts.join("; "));
}

function clearOAuthStateCookie(res) {
  const cookieParts = [
    `${config.oauthStateCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (config.frontendUrl.startsWith("https://")) cookieParts.push("Secure");

  appendCookie(res, cookieParts.join("; "));
}

async function requireCurrentUser(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    sendJson(res, 401, { error: "Not authenticated" });
    return null;
  }

  return user;
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return sendJson(res, 401, { error: "Not authenticated" });

  return sendJson(res, 200, { user });
}

async function handle42Start(req, res) {
  if (!config.intraClientId)
    return sendJson(res, 500, { error: "42 OAuth is not configured" });
  const state = buildOAuthState();
  setOAuthStateCookie(res, state);
  const authorizeUrl = new URL(config.intraAuthorizeUrl);
  authorizeUrl.searchParams.set("client_id", config.intraClientId);
  authorizeUrl.searchParams.set("redirect_uri", config.intraRedirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "public");
  authorizeUrl.searchParams.set("state", state);
  return redirect(res, authorizeUrl.toString());
}

async function handle42Callback(req, res) {
  const url = new URL(req.url, config.frontendUrl);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req.headers.cookie);

  if (!code || !state || cookies[config.oauthStateCookieName] !== state) {
    clearOAuthStateCookie(res);
    return redirect(res, `${config.frontendUrl}/login.html?auth=42-error`);
  }

  if (!config.intraClientId || !config.intraClientSecret) {
    clearOAuthStateCookie(res);
    return sendJson(res, 500, { error: "42 OAuth is not configured" });
  }

  try {
    const tokenResponse = await fetch(config.intraTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: config.intraClientId,
        client_secret: config.intraClientSecret,
        code,
        redirect_uri: config.intraRedirectUri,
      }),
    });

    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenPayload.access_token)
      throw new Error(
        tokenPayload.error_description || "Unable to get 42 access token",
      );

    const profileResponse = await fetch(config.intraUserUrl, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });

    const profile = await profileResponse.json();

    if (!profileResponse.ok || !profile.id)
      throw new Error("Unable to read 42 profile");

    const oauth42Id = Number(profile.id);
    const email = String(profile.email || `intra-${oauth42Id}@42.local`)
      .trim()
      .toLowerCase();
    const username = String(profile.login || `intra_${oauth42Id}`).trim();
    const oauthAvatarUrl = profile.image?.link || null;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ oauth42Id }, { email }, { username }],
      },
    });

    let user;
    let isNewUser = false;

    if (existingUser) {
      const hasLocalAvatar =
        existingUser.avatarUrl &&
        existingUser.avatarUrl.startsWith("/api/me/avatar");
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          oauth42Id,
          email,
          username,
          oauthAvatarUrl,
          avatarUrl: hasLocalAvatar ? existingUser.avatarUrl : null,
        },
      });

      if (!hasLocalAvatar) {
        const avatarSaved = await saveOAuthAvatar(
          existingUser.id,
          oauthAvatarUrl,
        );

        if (avatarSaved) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { avatarUrl: "/api/me/avatar", avatarSource: "oauth" },
          });
        }
      }
    } else {
      user = await prisma.user.create({
        data: {
          oauth42Id,
          email,
          username,
          avatarUrl: null,
          oauthAvatarUrl,
          passwordHash: hashPassword(crypto.randomBytes(16).toString("hex")),
        },
      });
      const avatarSaved = await saveOAuthAvatar(user.id, oauthAvatarUrl);
      if (avatarSaved) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: "/api/me/avatar", avatarSource: "oauth" },
        });
      }
      isNewUser = true;
    }

    if (isNewUser) {
      await unlockAchievement(user.id, "Fresh Meat");
    }

    setSessionCookie(res, signSessionToken(user.id));
    clearOAuthStateCookie(res);

    return redirect(res, `${config.frontendUrl}/profile.html?auth=42-success`);
  } catch (error) {
    console.error("42 OAuth failed:", error);
    clearOAuthStateCookie(res);
    return redirect(res, `${config.frontendUrl}/login.html?auth=42-error`);
  }
}

async function handleLogout(req, res) {
  clearSessionCookie(res);
  return sendJson(res, 200, { message: "Logged out successfully" });
}

async function handleLogin(req, res) {
  let payload;

  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch (error) {
    return sendJson(res, 400, { error: "Invalid JSON payload" });
  }

  const identifier = String(
    payload.identifier || payload.email || payload.username || "",
  ).trim();

  const email = identifier.includes("@") ? identifier.toLowerCase() : "";
  const username = identifier.includes("@") ? "" : identifier;
  const password = String(payload.password || "");

  if (!identifier || !password) {
    return sendJson(res, 400, {
      error: "Email or login and password are required",
    });
  }

  try {
    const user = email
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findUnique({ where: { username } });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

    setSessionCookie(res, signSessionToken(user.id));

    return sendJson(res, 200, {
      message: "Login successful",
      user: {
        id: user.id,
        oauth42Id: user.oauth42Id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        mmr: user.mmr,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);
    return sendJson(res, 500, { error: "Could not log in user" });
  }
}

async function handleRegister(req, res) {
  let payload;

  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch (error) {
    return sendJson(res, 400, { error: "Invalid JSON payload" });
  }

  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");

  if (!email || !username || !password) {
    return sendJson(res, 400, {
      error: "Email, login and password are required",
    });
  }

  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: "Invalid email format" });
  }

  if (!isValidUsername(username)) {
    return sendJson(res, 400, {
      error:
        "Login must be 3-20 characters and use only letters, numbers, or underscores",
    });
  }

  if (password.length < 8) {
    return sendJson(res, 400, {
      error: "Password must be at least 8 characters long",
    });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return sendJson(res, 409, { error: "User already exists" });
    }

    if (existingUsername) {
      return sendJson(res, 409, { error: "Login already exists" });
    }

    const user = await prisma.user.create({
      data: {
        oauth42Id: null,
        email,
        username,
        avatarUrl: null,
        passwordHash: hashPassword(password),
      },
    });

    await unlockAchievement(user.id, "Fresh Meat");

    return sendJson(res, 201, {
      message: "User registered successfully",
      user: {
        id: user.id,
        oauth42Id: user.oauth42Id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return sendJson(res, 500, { error: "Could not register user" });
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return /^[A-Za-z0-9_]{3,20}$/.test(username);
}

function verifyPassword(password, storedPasswordHash) {
  const [salt, storedHash] = String(storedPasswordHash || "").split(":");

  if (!salt || !storedHash) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(derivedKey, "hex");
  const b = Buffer.from(storedHash, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const cookieParts = cookieHeader.split(";");
  for (const part of cookieParts) {
    const cookie = part.trim();
    if (!cookie) continue;
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

function signSessionToken(userId) {
  const payload = JSON.stringify({
    userId,
    issuedAt: Date.now(),
  });

  const encodedPayload = base64UrlEncode(payload);
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expectedSignature, "utf8");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return Number.isInteger(payload.userId) ? payload : null;
  } catch (error) {
    return null;
  }
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[sessionCookieName]);
  if (!session) return null;

  return prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      oauth42Id: true,
      email: true,
      username: true,
      avatarUrl: true,
      oauthAvatarUrl: true,
      avatarSource: true,
      mmr: true,
      createdAt: true,
    },
  });
}

module.exports = {
  handleRegister,
  handleLogin,
  handleLogout,
  handleMe,
  handle42Start,
  handle42Callback,
  getCurrentUser,
  requireCurrentUser,
  signSessionToken,
  verifySessionToken,
};
