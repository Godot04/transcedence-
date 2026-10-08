const http = require('http');
const prisma = require('./db');
const config = require('./config');
const {sendJson} = require('./http');
const 
{
  handleRegister,
  handleLogin,
  handleLogout,
  handleMe,
  handle42Start,
  handle42Callback,
  requireCurrentUser,
} = require('./auth');

const 
{
  initializeAchievements,
  handleMyAchievements,
  handleAllAchievements,
} = require('./achievements');

const {
  handleAvatarUpload,
  handleAvatarDelete,
  handleAvatar,
  handlePublicAvatar,
  handleDescriptionUpload,
  handleDescriptionDelete,
  handlePublicProfile,
} = require('./profile');

async function requestHandler(req, res) 
{
  const url = new URL(req.url, config.frontendUrl);

  if (req.method === 'DELETE' && url.pathname === '/api/me/avatar')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
      return;
    return handleAvatarDelete(req, res, user);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') 
  {
    return sendJson(res, 200, 
    {
      status: 'ok',
      service: 'backend',
      port: config.port, 
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

  const publicProfileMatch = url.pathname.match(/^\/api\/users\/(\d+)\/profile$/);
  if (req.method === 'GET' && publicProfileMatch) 
  {
    const userId = Number(publicProfileMatch[1]);
    return handlePublicProfile(req, res, userId);
  }
  
  const publicAvatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (req.method === 'GET' && publicAvatarMatch) 
  {
    const userId = Number(publicAvatarMatch[1]);
    return handlePublicAvatar(req, res, userId);
  }

  if (req.method === 'POST' && url.pathname === '/api/register')
    return handleRegister(req, res);

  if (req.method === 'POST' && url.pathname === '/api/login')
    return handleLogin(req, res);

  if (req.method === 'GET' && url.pathname === '/api/me')
    return handleMe(req, res);

  if (req.method === 'POST' && url.pathname === '/api/logout')
    return handleLogout(req, res);

  if (req.method === 'GET' && url.pathname === '/api/me/achievements')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
        return;
    return handleMyAchievements(req, res, user);
  }

  if (req.method === 'GET' && url.pathname === '/api/achievements')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
      return;
    return handleAllAchievements(req, res, user);
  }

  if (req.method === 'POST' && url.pathname === '/api/me/avatar')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
        return;
    return handleAvatarUpload(req, res, user);
  }

  if (req.method === 'GET' && url.pathname === '/api/me/avatar')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
        return;
    return handleAvatar(req, res, user);
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/42/start')
    return handle42Start(req, res);

  if (req.method === 'GET' && url.pathname === '/api/auth/42/callback')
    return handle42Callback(req, res);

  if (req.method === 'POST' && url.pathname === '/api/me/description')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
      return;
    return handleDescriptionUpload(req, res, user);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/me/description')
  {
    const user = await requireCurrentUser(req, res);
    if (!user)
      return;
    return handleDescriptionDelete(req, res, user);
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

    server.listen(config.port, '0.0.0.0', () => {
      console.log(`Backend listening on port ${config.port}`);
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
