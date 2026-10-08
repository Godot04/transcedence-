let showingAllAchievements = false;

allAchievementsButton.addEventListener('click', async () =>
{
    if (showingAllAchievements)
    {
        showingAllAchievements = false;
        await loadMyAchievements();
        allAchievementsButton.textContent = 'View All Achievements';
        return;
    }

    showingAllAchievements = true;

    try
    {
        const response = await fetch('/api/achievements');

        if (!response.ok)
            throw new Error('Failed to load achievements');

        const data = await response.json();

        renderAchievements(data.achievements, true);
        allAchievementsButton.textContent = 'Back to My Achievements';
    }
    catch (error)
    {
        console.error('Failed to load all achievements:', error);
        showingAllAchievements = false;
    }
});

async function loadMyAchievements()
{
    try
    {
        const response = await fetch('/api/me/achievements');

        if (!response.ok)
            throw new Error('Failed to load achievements');

        const data = await response.json();
        renderAchievements(data.achievements, false);
    }
    catch (error)
    {
        console.error('Failed to load achievements:', error);
    }
}

function renderAchievements(achievements, showLockedOnly)
{
    achievementsList.innerHTML = '';

    const visibleAchievements = showLockedOnly
        ? achievements.filter((achievement) => !achievement.unlocked)
        : achievements;

    if (visibleAchievements.length === 0)
    {
        achievementsList.innerHTML = `
            <p class="no-achievements">
                ${showLockedOnly
                    ? 'You have unlocked all achievements!'
                    : 'No achievements unlocked yet.'}
            </p>
        `;
        return;
    }

    for (const achievement of visibleAchievements)
    {
        const element = document.createElement('div');
        element.className = 'achievement';

        if (!achievement.unlocked)
            element.classList.add('locked');

        element.innerHTML = `
            <div class="achievement-icon">
                <img src="${achievement.iconUrl}" alt="">
            </div>
            <div class="achievement-info">
                <strong>${achievement.name}</strong>
                <span>${achievement.description}</span>
            </div>
        `;

        achievementsList.appendChild(element);
    }
}

loadMyAchievements();