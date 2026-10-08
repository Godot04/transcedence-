const prisma = require('./db');
const {sendJson} = require('./http');

const achievements = [
  {
    name: 'Fresh Meat',
    description: 'Welcome to the battlefield, captain.',
    iconUrl: '/icons/achievements/fresh-meat.png',
  },
  {
    name: 'First Blood',
    description: 'Destroy your first enemy ship.',
    iconUrl: '/icons/achievements/first-blood.png',
  },
  {
    name: 'Sea Dog',
    description: 'Win 10 battles.',
    iconUrl: '/icons/achievements/sea-dog.png',
  },
  {
    name: 'Destroyer',
    description: 'Destroy the entire enemy fleet.',
    iconUrl: '/icons/achievements/destroyer.png',
  },
  {
    name: 'Untouchable',
    description: 'Win a battle without losing a ship.',
    iconUrl: '/icons/achievements/untouchable.png',
  },
];

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

async function handleMyAchievements(req, res, user)
{
  try 
  {
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

async function handleAllAchievements(req, res, user) 
{
  try 
  {
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

module.exports = {
    initializeAchievements,
    unlockAchievement,
    handleMyAchievements,
    handleAllAchievements,
};