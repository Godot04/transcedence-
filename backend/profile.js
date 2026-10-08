const path = require('path');
const fs = require('fs');
const prisma = require('./db');
const MAX_DESCRIPTION_SIZE = 50 * 1024;
const avatarDirectory = path.join(__dirname, 'uploads', 'avatars', );
const descriptionDirectory = path.join(__dirname, 'uploads', 'descriptions',);
fs.mkdirSync(avatarDirectory, { recursive: true, });
fs.mkdirSync(descriptionDirectory, { recursive: true, });
const { sendJson, readBody, readRawBody, } = require('./http');

function sendAvatarFile(res, user)
{
    const extensions = [
        ['png', 'image/png'],
        ['jpg', 'image/jpeg'],
        ['webp', 'image/webp'],
    ];

    for (const [extension, contentType] of extensions)
    {
        const filePath = path.join(
            avatarDirectory,
            `${user.id}.${extension}`,
        );

        if (fs.existsSync(filePath))
        {
            res.writeHead(200,
            {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache',
            });

            return fs.createReadStream(filePath).pipe(res);
        }
    }

    res.writeHead(404);
    res.end('Avatar not found');
}

async function saveOAuthAvatar(userId, avatarUrl)
{
  if (!avatarUrl)
    return false;

  try
  {
    const response = await fetch(avatarUrl);

    if (!response.ok)
    {
      console.error(
        `Failed to download 42 avatar: HTTP ${response.status}`
      );

      return false;
    }

    const contentType =
      response.headers.get('content-type') || '';

    let extension = null;

    if (contentType.includes('image/jpeg'))
      extension = 'jpg';
    else if (contentType.includes('image/png'))
      extension = 'png';
    else if (contentType.includes('image/webp'))
      extension = 'webp';

    if (!extension)
    {
      console.error(
        `Unsupported 42 avatar content type: ${contentType}`
      );

      return false;
    }

    const imageBuffer =
      Buffer.from(await response.arrayBuffer());

    if (imageBuffer.length > 2 * 1024 * 1024)
    {
      console.error('42 avatar is larger than 2 MB');
      return false;
    }

    const extensions = ['png', 'jpg', 'webp'];

    for (const oldExtension of extensions)
    {
      if (oldExtension === extension)
        continue;

      const oldPath =
        path.join(
          avatarDirectory,
          `${userId}.${oldExtension}`
        );

      try
      {
        await fs.promises.unlink(oldPath);
      }
      catch (error)
      {
        if (error.code !== 'ENOENT')
          throw error;
      }
    }

    const filePath =
      path.join(
        avatarDirectory,
        `${userId}.${extension}`
      );

    await fs.promises.writeFile(
      filePath,
      imageBuffer
    );

    return true;
  }
  catch (error)
  {
    console.error(
      'Failed to save 42 avatar:',
      error
    );

    return false;
  }
}

async function handleAvatarUpload(req, res, user)
{
  if (!user)
    return sendJson(res, 401, {error: 'Not authenticated',});
  let payload;
  try
  {
    payload = JSON.parse(await readBody(req) || '{}');
  }
  catch (error)
  {
    return sendJson(res, 400, {error: 'Invalid JSON payload',});
  }
  const image = String(payload.image || '');
  const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match)
    return sendJson(res, 400, {error: 'Invalid image format',});
  const mimeType = match[1];
  const base64Data = match[2];
  const imageBuffer = Buffer.from( base64Data,'base64');
  if (imageBuffer.length > 2 * 1024 * 1024)
  {
    return sendJson(res, 400, { error: 'Image must be smaller than 2 MB',});
  }
  let extension = 'webp';
  if (mimeType === 'image/png')
  {
    extension = 'png';
  }
  else if (mimeType === 'image/jpeg')
  {
    extension = 'jpg';
  }
  const extensions = ['png', 'jpg', 'webp'];
  try
  {
    for (const oldExtension of extensions)
    {
      const oldPath = path.join( avatarDirectory, `${user.id}.${oldExtension}`);
      try
      {
        await fs.promises.unlink(oldPath);
      }
      catch (error)
      {
        if (error.code !== 'ENOENT')
          throw error;
      }
    }
    const filePath = path.join(avatarDirectory,`${user.id}.${extension}`);
    await fs.promises.writeFile(filePath, imageBuffer);
    const avatarUrl = '/api/me/avatar';
    await prisma.user.update(
    {
      where: {id: user.id,},
      data: {avatarUrl, avatarSource: 'custom',},
    });
    return sendJson(res, 200, 
    {
      message: 'Avatar updated successfully',
      avatarUrl,
      avatarSource:'custom',
    });
  }
  catch (error)
  {
    console.error('Failed to save avatar:', error);
    return sendJson(res, 500, {error: 'Could not save avatar',});
  }
}

async function handleAvatarDelete(req, res, user)
{
  if (!user)
    return sendJson(res, 401, {error: 'Not authenticated',});
  const extensions = ['png', 'jpg', 'webp'];
  try
  {
    for (const extension of extensions)
    {
      const filePath = path.join(avatarDirectory,`${user.id}.${extension}`);
      try
      {
        await fs.promises.unlink(filePath);
      }
      catch (error)
      {
         if (error.code !== 'ENOENT')
            throw error;
      }
    }
    if (user.oauthAvatarUrl)
    {
      const avatarSaved = await saveOAuthAvatar(user.id, user.oauthAvatarUrl);
      if (avatarSaved)
      {
        await prisma.user.update(
        {
          where: {id: user.id,},
          data: {avatarUrl: '/api/me/avatar', avatarSource: 'oauth',},
        });
        return sendJson(res, 200, 
        {
          message: 'Profile picture deleted successfully',
          avatarUrl: '/api/me/avatar',
          avatarSource:'oauth',
        });
      }
    }
    await prisma.user.update(
    {
      where: {id: user.id,},
      data: {avatarUrl: null, avatarSource: null,},
    });
    return sendJson(res, 200, 
    {
      message:'Profile picture deleted successfully',
      avatarUrl: null,
      avatarSource: null,
    });
  }
  catch (error)
  {
    console.error('Failed to delete avatar:', error);
    return sendJson(res, 500, { error: 'Could not delete avatar',});
  }
}

function handleAvatar(req, res, user)
{
  return sendAvatarFile(res, user);
}

async function handlePublicAvatar(req, res, userId) 
{
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      avatarUrl: true,
    },
  });

  if (!user) {
    res.writeHead(404);
    res.end('User not found');
    return;
  }

  return sendAvatarFile(res, user);
}

async function handleDescriptionDelete(req, res, user) 
{
  if (!user) 
    return sendJson(res, 401, { error: 'Not authenticated', });

  const filePath = path.join(descriptionDirectory, `${user.id}.txt`,);
  try 
  {
    await fs.promises.unlink(filePath);

    return sendJson(res, 200, { message: 'Description deleted successfully', description: null, });
  } 
  catch (error) 
  {
    if (error.code === 'ENOENT') 
      return sendJson(res, 404, { error: 'Description not found', });

    console.error('Failed to delete description:', error);
    return sendJson(res, 500, { error: 'Could not delete description', });
  }
}

async function handleDescriptionUpload(req, res, user) 
{
    if (!user) 
        return sendJson(res, 401, { error: 'Not authenticated', });
    const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
    
    if (contentType !== 'text/plain') 
        return sendJson(res, 400, { error: 'Only TXT files are allowed', });

    try 
    {
        const buffer = await readRawBody(req, MAX_DESCRIPTION_SIZE);
        if (buffer.length === 0) 
            return sendJson(res, 400, { error: 'Description cannot be empty', });
        const text = buffer.toString('utf8');
        if (text.includes('\u0000')) 
            return sendJson(res, 400, { error: 'Invalid text file', });
        const trimmedText = text.trim();
        if (!trimmedText) 
            return sendJson(res, 400, { error: 'Description cannot be empty', });
        if (trimmedText.length > 1000) 
            return sendJson(res, 400, { error: 'Description must be 1000 characters or less', });
        const filePath = path.join(descriptionDirectory, `${user.id}.txt`, );
    await fs.promises.writeFile(
      filePath,
      text,
      'utf8',
    );

    return sendJson(res, 200, {
      message: 'Description uploaded successfully',
      description: text,
    });
  } catch (error) {
    console.error('Failed to save description:', error);

    return sendJson(res, 500, {
      error: 'Could not save description',
    });
  }
}

async function handlePublicProfile(req, res, userId) 
{
  const user = await prisma.user.findUnique(
  {
    where: { id: userId, },
    select: 
    {
      id: true,
      username: true,
      avatarUrl: true,
      mmr: true,
      createdAt: true,
    },
  });

  if (!user) 
    return sendJson(res, 404, { error: 'User not found', });

  const descriptionPath = path.join( descriptionDirectory, `${user.id}.txt`, );
  let description = null;
  try 
  {
    description = await fs.promises.readFile( descriptionPath, 'utf8', );
  }
  catch (error) 
  {
    if (error.code !== 'ENOENT') 
      console.error('Failed to read profile description:', error);
  }

  return sendJson(res, 200, 
  {
    user: 
    {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl ? `/api/users/${user.id}/avatar` : null,
      mmr: user.mmr,
      createdAt: user.createdAt,
      description,
    },
  });
}

module.exports = 
{
    saveOAuthAvatar,
    handleAvatarUpload,
    handleAvatarDelete,
    handleAvatar,
    handlePublicAvatar,
    handleDescriptionUpload,
    handleDescriptionDelete,
    handlePublicProfile,
};