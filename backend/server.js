const http = require('http');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const achievements = [
  {
    name: 'Fresh Meat',
    description: 'Welcome to the battlefield, captain.',
    iconUrl: '/icons/achievements/fresh-meat.svg',
  },
  {
    name: 'First Blood',
    description: 'Win your first battle.',
    iconUrl: '/icons/achievements/first-blood.svg',
  },
  {
    name: 'Sea Dog',
    description: 'Win 10 battles.',
    iconUrl: '/icons/achievements/sea-dog.svg',
  },
  {
    name: 'Destroyer',
    description: 'Destroy the entire enemy fleet.',
    iconUrl: '/icons/achievements/destroyer.svg',
  },
  {
    name: 'Untouchable',
    description: 'Win a battle without losing a ship.',
    iconUrl: '/icons/achievements/untouchable.svg',
  },
];

const port = Number(process.env.PORT || 3000);
const prisma = new PrismaClient();
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret';
const sessionCookieName = 'transcendence_session';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
const intraClientId = process.env.INTRA_CLIENT_ID || '';
const intraClientSecret = process.env.INTRA_CLIENT_SECRET || '';
const intraRedirectUri = process.env.INTRA_REDIRECT_URI || 'http://localhost:8080/api/auth/42/callback';
const intraAuthorizeUrl = 'https://api.intra.42.fr/oauth/authorize';
const intraTokenUrl = 'https://api.intra.42.fr/oauth/token';
const intraUserUrl = 'https://api.intra.42.fr/v2/me';

const avatarDirectory = path.join(__dirname, 'uploads', 'avatars');
fs.mkdirSync(avatarDirectory, { recursive: true });

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > 4_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedPasswordHash) {
  const [salt, storedHash] = String(storedPasswordHash || '').split(':');

  if (!salt || !storedHash) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derivedKey, 'hex');
  const b = Buffer.from(storedHash, 'hex');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      cookies[key] = value;
      return cookies;
    }, {});
}

function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');

  if (!existing) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }

  res.setHeader('Set-Cookie', [existing, cookie]);
}

function setSessionCookie(res, token) {
  const cookieParts = [
    `${sessionCookieName}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  appendCookie(res, cookieParts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

function buildOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

function setOAuthStateCookie(res, state) {
  const cookieParts = [
    `transcendence_oauth_state=${state}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearOAuthStateCookie(res) {
  appendCookie(
    res,
    'transcendence_oauth_state=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signSessionToken(userId) {
  const payload = JSON.stringify({
    userId,
    issuedAt: Date.now(),
  });

  const encodedPayload = base64UrlEncode(payload);
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', sessionSecret)
    .update(encodedPayload)
    .digest('base64url');

  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expectedSignature, 'utf8');

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

  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      oauth42Id: true,
      email: true,
      username: true,
      avatarUrl: true,
      oauthAvatarUrl: true,
      mmr: true,
      createdAt: true,
    },
  });
}

async function unlockAchievement(userId, achievementName) {
  const achievement = await prisma.achievement.findUnique({
    where: { name: achievementName },
  });

  if (!achievement) {
    console.error(`Achievement not found: ${achievementName}`);
    return;
  }

  await prisma.userAchievement.upsert({
    where: {
      userId_achievementId: {
        userId,
        achievementId: achievement.id,
      },
    },
    update: {},
    create: {
      userId,
      achievementId: achievement.id,
    },
  });
}

async function initializeAchievements() {
  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { name: achievement.name },
      update: {
        description: achievement.description,
        iconUrl: achievement.iconUrl,
      },
      create: achievement,
    });
  }
}

async function handleRegister(req, res) {
  let payload;

  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return sendJson(res, 400, { error: 'Invalid JSON payload' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');

  if (!email || !username || !password) {
    return sendJson(res, 400, {
      error: 'Email, login and password are required',
    });
  }

  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: 'Invalid email format' });
  }

  if (!isValidUsername(username)) {
    return sendJson(res, 400, {
      error: 'Login must be 3-20 characters and use only letters, numbers, or underscores',
    });
  }

  if (password.length < 8) {
    return sendJson(res, 400, {
      error: 'Password must be at least 8 characters long',
    });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    const existingUsername = await prisma.user.findUnique({ where: { username } });

    if (existingUser) {
      return sendJson(res, 409, { error: 'User already exists' });
    }

    if (existingUsername) {
      return sendJson(res, 409, { error: 'Login already exists' });
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

    await unlockAchievement(user.id, 'Fresh Meat');

    return sendJson(res, 201, {
      message: 'User registered successfully',
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
    console.error('Registration failed:', error);
    return sendJson(res, 500, { error: 'Could not register user' });
  }
}

async function handleLogin(req, res) {
  let payload;

  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return sendJson(res, 400, { error: 'Invalid JSON payload' });
  }

  const identifier = String(
    payload.identifier || payload.email || payload.username || '',
  ).trim();

  const email = identifier.includes('@') ? identifier.toLowerCase() : '';
  const username = identifier.includes('@') ? '' : identifier;
  const password = String(payload.password || '');

  if (!identifier || !password) {
    return sendJson(res, 400, {
      error: 'Email or login and password are required',
    });
  }

  try {
    const user = email
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findUnique({ where: { username } });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'Invalid email or password' });
    }

    setSessionCookie(res, signSessionToken(user.id));

    return sendJson(res, 200, {
      message: 'Login successful',
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
    console.error('Login failed:', error);
    return sendJson(res, 500, { error: 'Could not log in user' });
  }
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }

  return sendJson(res, 200, { user });
}

async function handleMyAchievements(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }

  try {
    const rows = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      orderBy: { unlockedAt: 'desc' },
      include: { achievement: true },
    });

    return sendJson(res, 200, {
      achievements: rows.map((entry) => ({
        id: entry.achievement.id,
        name: entry.achievement.name,
        description: entry.achievement.description,
        iconUrl: entry.achievement.iconUrl,
        unlocked: true,
        unlockedAt: entry.unlockedAt,
      })),
    });
  } catch (error) {
    console.error('Failed to load achievements:', error);
    return sendJson(res, 500, { error: 'Could not load achievements' });
  }
}

async function handleAllAchievements(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }

  try {
    const rows = await prisma.achievement.findMany({
      orderBy: { id: 'asc' },
      include: {
        users: {
          where: { userId: user.id },
          select: { unlockedAt: true },
        },
      },
    });

    return sendJson(res, 200, {
      achievements: rows.map((achievement) => ({
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        iconUrl: achievement.iconUrl,
        unlocked: achievement.users.length > 0,
        unlockedAt: achievement.users[0]?.unlockedAt || null,
      })),
    });
  } catch (error) {
    console.error('Failed to load all achievements:', error);
    return sendJson(res, 500, { error: 'Could not load achievements' });
  }
}

async function handle42Start(req, res) {
  if (!intraClientId) {
    return sendJson(res, 500, { error: '42 OAuth is not configured' });
  }

  const state = buildOAuthState();
  setOAuthStateCookie(res, state);

  const authorizeUrl = new URL(intraAuthorizeUrl);
  authorizeUrl.searchParams.set('client_id', intraClientId);
  authorizeUrl.searchParams.set('redirect_uri', intraRedirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'public');
  authorizeUrl.searchParams.set('state', state);

  return redirect(res, authorizeUrl.toString());
}

async function handle42Callback(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req.headers.cookie);

  if (!code || !state || cookies.transcendence_oauth_state !== state) {
    clearOAuthStateCookie(res);
    return redirect(res, `${frontendUrl}/login.html?auth=42-error`);
  }

  if (!intraClientId || !intraClientSecret) {
    clearOAuthStateCookie(res);
    return sendJson(res, 500, { error: '42 OAuth is not configured' });
  }

  try {
    const tokenResponse = await fetch(intraTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: intraClientId,
        client_secret: intraClientSecret,
        code,
        redirect_uri: intraRedirectUri,
      }),
    });

    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(
        tokenPayload.error_description || 'Unable to get 42 access token',
      );
    }

    const profileResponse = await fetch(intraUserUrl, {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });

    const profile = await profileResponse.json();

    if (!profileResponse.ok || !profile.id) {
      throw new Error('Unable to read 42 profile');
    }

    const oauth42Id = Number(profile.id);
    const email = String(
      profile.email || `intra-${oauth42Id}@42.local`,
    ).trim().toLowerCase();
    const username = String(
      profile.login || `intra_${oauth42Id}`,
    ).trim();
    const oauthAvatarUrl = profile.image?.link || null;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { oauth42Id },
          { email },
          { username },
        ],
      },
    });

    let user;
    let isNewUser = false;

    if (existingUser) {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          oauth42Id,
          email,
          username,
          oauthAvatarUrl,
          // Keep a locally uploaded avatar if the user already has one.
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          oauth42Id,
          email,
          username,
          avatarUrl: oauthAvatarUrl,
          oauthAvatarUrl,
          passwordHash: hashPassword(crypto.randomBytes(16).toString('hex')),
        },
      });
      isNewUser = true;
    }

    if (isNewUser) {
      await unlockAchievement(user.id, 'Fresh Meat');
    }

    setSessionCookie(res, signSessionToken(user.id));
    clearOAuthStateCookie(res);

    return redirect(res, `${frontendUrl}/profile.html?auth=42-success`);
  } catch (error) {
    console.error('42 OAuth failed:', error);
    clearOAuthStateCookie(res);
    return redirect(res, `${frontendUrl}/login.html?auth=42-error`);
  }
}

async function handleLogout(req, res) {
  clearSessionCookie(res);
  return sendJson(res, 200, { message: 'Logged out successfully' });
}

async function handleAvatar(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    res.writeHead(401);
    res.end('Not authenticated');
    return;
  }

  if (!user.avatarUrl || !user.avatarUrl.startsWith('/api/me/avatar')) {
    res.writeHead(404);
    res.end('Avatar not found');
    return;
  }

  const extensions = ['png', 'jpg', 'webp'];
  const contentTypes = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
  };

  for (const extension of extensions) {
    const filePath = path.join(
      avatarDirectory,
      `${user.id}.${extension}`,
    );

    try {
      await fs.promises.access(filePath);

      res.writeHead(200, {
        'Content-Type': contentTypes[extension],
        'Cache-Control': 'no-cache',
      });

      fs.createReadStream(filePath).pipe(res);
      return;
    } catch (error) {
      // Try the next extension.
    }
  }

  res.writeHead(404);
  res.end('Avatar not found');
}

async function handleAvatarDelete(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    return sendJson(res, 401, {
      error: 'Not authenticated',
    });
  }

  const extensions = ['png', 'jpg', 'webp'];

  try {
    for (const extension of extensions) {
      const filePath = path.join(
        avatarDirectory,
        `${user.id}.${extension}`,
      );

      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        avatarUrl: user.oauthAvatarUrl || null,
      },
    });

    return sendJson(res, 200, {
      message: 'Avatar deleted successfully',
      avatarUrl: user.oauthAvatarUrl || null,
    });
  } catch (error) {
    console.error('Failed to delete avatar:', error);
    return sendJson(res, 500, {
      error: 'Could not delete avatar',
    });
  }
}

async function handleAvatarUpload(req, res) {
  const user = await getCurrentUser(req);

  if (!user) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }

  let payload;

  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return sendJson(res, 400, { error: 'Invalid JSON payload' });
  }

  const image = String(payload.image || '');
  const match = image.match(
    /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/,
  );

  if (!match) {
    return sendJson(res, 400, { error: 'Invalid image format' });
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const imageBuffer = Buffer.from(base64Data, 'base64');

  if (imageBuffer.length > 2 * 1024 * 1024) {
    return sendJson(res, 400, {
      error: 'Image must be smaller than 2 MB',
    });
  }

  let extension = 'webp';

  if (mimeType === 'image/png') {
    extension = 'png';
  } else if (mimeType === 'image/jpeg') {
    extension = 'jpg';
  }

  const extensions = ['png', 'jpg', 'webp'];

  try {
    for (const oldExtension of extensions) {
      const oldPath = path.join(
        avatarDirectory,
        `${user.id}.${oldExtension}`,
      );

      try {
        await fs.promises.unlink(oldPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    const filePath = path.join(
      avatarDirectory,
      `${user.id}.${extension}`,
    );

    await fs.promises.writeFile(filePath, imageBuffer);

    const avatarUrl = '/api/me/avatar';

    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });

    return sendJson(res, 200, {
      message: 'Avatar updated successfully',
      avatarUrl,
    });
  } catch (error) {
    console.error('Failed to save avatar:', error);
    return sendJson(res, 500, { error: 'Could not save avatar' });
  }
}

async function requestHandler(req, res) 
{
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'DELETE' && url.pathname === '/api/me/avatar') 
  {
    return handleAvatarDelete(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') 
  {
    return sendJson(res, 200, 
    {
      status: 'ok',
      service: 'backend',
      port,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api') {
    return sendJson(res, 200, {
      message: 'Transcendence backend is running',
      endpoints: [
        '/api/health',
        '/api/register',
        '/api/login',
        '/api/me',
        '/api/logout',
        '/api/me/achievements',
        '/api/achievements',
        '/api/me/avatar',
        '/api/auth/42/start',
        '/api/auth/42/callback',
      ],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    return handleRegister(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    return handleLogin(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    return handleMe(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    return handleLogout(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/me/achievements') {
    return handleMyAchievements(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/achievements') {
    return handleAllAchievements(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/me/avatar') {
    return handleAvatarUpload(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/me/avatar') {
    return handleAvatar(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/42/start') {
    return handle42Start(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/42/callback') {
    return handle42Callback(req, res);
  }

  return sendJson(res, 404, { error: 'Not found' });
}

async function main() {
  try {
    await prisma.$connect();
    await initializeAchievements();

    const server = http.createServer((req, res) => {
      requestHandler(req, res).catch((error) => {
        console.error('Unexpected request error:', error);
        sendJson(res, 500, { error: 'Internal server error' });
      });
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`Backend listening on port ${port}`);
    });

    const shutdown = async () => {
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

main();
