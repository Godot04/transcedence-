const usernameElement = document.getElementById('username');
const emailElement = document.getElementById('email');
const avatarElement = document.getElementById('avatar');
const avatarButton = document.getElementById('avatar-button');
const avatarInput = document.getElementById('avatar-input');
const avatarPlaceholder = document.getElementById('avatar-placeholder');
const infoUsername = document.getElementById('info-username');
const infoEmail = document.getElementById('info-email');
const infoId = document.getElementById('info-id');
const infoOauth = document.getElementById('info-oauth');
const infoCreated = document.getElementById('info-created');
const logoutButton = document.getElementById('logout-button');
const rankElement = document.getElementById('rank-name');
const mmrElement = document.getElementById('mmr');
const mmrModal = document.getElementById('mmr-modal');
const closeMmr = document.getElementById('close-mmr');
const rankList = document.getElementById('rank-list');
const achievementsList = document.getElementById('achievements-list');
const allAchievementsButton = document.getElementById('all-achievements-button');
const rankButton = document.getElementById('rank-button');
const deleteAvatarButton = document.getElementById('delete-avatar-button');

const ranks = [
    { name: 'Recruit', mmr: 0 },
    { name: 'Seaman Recruit', mmr: 100 },
    { name: 'Seaman', mmr: 250 },
    { name: 'Petty Officer', mmr: 500 },
    { name: 'Chief Petty Officer', mmr: 750 },
    { name: 'Ensign', mmr: 1000 },
    { name: 'Lieutenant', mmr: 1500 },
    { name: 'Commander', mmr: 2000 },
];

function updateAvatarState(hasAvatar)
{
    avatarButton.classList.toggle('has-avatar', hasAvatar);
}

function readFileAsDataURL(file)
{
    return new Promise((resolve, reject) =>
    {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
    });
}

avatarButton.addEventListener('click', (event) =>
{
    if (event.target.closest('#delete-avatar-button'))
        return;
    avatarInput.click();
});

avatarInput.addEventListener('change', async () =>
{
    const file = avatarInput.files[0];

    if (!file)
        return;

    if (!file.type.startsWith('image/'))
    {
        alert('Please select an image.');
        avatarInput.value = '';
        return;
    }

    if (file.size > 2 * 1024 * 1024)
    {
        alert('Image must be smaller than 2 MB.');
        avatarInput.value = '';
        return;
    }

    try
    {
        const imageData = await readFileAsDataURL(file);

        const response = await fetch('/api/me/avatar',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: imageData }),
        });

        const type = response.headers.get('content-type') || '';
        const data = type.includes('application/json')
            ? await response.json()
            : {};

        if (!response.ok)
        {
            throw new Error(
                data.error || `Server returned HTTP ${response.status}`
            );
        }

        avatarElement.src = `${data.avatarUrl}?t=${Date.now()}`;
        avatarElement.classList.add('visible');
        avatarPlaceholder.classList.add('hidden');
        updateAvatarState(true);
    }
    catch (error)
    {
        console.error('Failed to upload avatar:', error);
        alert(error.message || 'Failed to upload profile picture.');
    }
    finally
    {
        avatarInput.value = '';
    }
});

deleteAvatarButton.addEventListener('click', async (event) =>
{
    event.stopPropagation();

    const confirmed =
        window.confirm('Delete your profile picture?');

    if (!confirmed)
        return;

    try
    {
        const response = await fetch('/api/me/avatar',
        {
            method: 'DELETE',
        });

        const type =
            response.headers.get('content-type') || '';

        const data =
            type.includes('application/json')
                ? await response.json()
                : {};

        if (!response.ok)
        {
            throw new Error(
                data.error ||
                `Server returned HTTP ${response.status}`
            );
        }

        if (data.avatarUrl)
        {
            avatarElement.src =
                `${data.avatarUrl}?t=${Date.now()}`;

            avatarElement.classList.add('visible');
            avatarPlaceholder.classList.add('hidden');
        }
        else
        {
            avatarElement.removeAttribute('src');
            avatarElement.classList.remove('visible');

            avatarPlaceholder.classList.remove('hidden');
        }
    }
    catch (error)
    {
        console.error(
            'Failed to delete avatar:',
            error
        );

        alert(
            error.message ||
            'Failed to delete profile picture.'
        );
    }
});

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

rankButton.addEventListener('click', () =>
{
    const mmr = Number(mmrElement.dataset.mmr || 0);
    renderRanks(mmr);
    mmrModal.classList.remove('hidden');
});

closeMmr.addEventListener('click', () =>
{
    mmrModal.classList.add('hidden');
});

mmrModal.addEventListener('click', (event) =>
{
    if (event.target === mmrModal)
        mmrModal.classList.add('hidden');
});

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

function renderRanks(mmr)
{
    rankList.innerHTML = '';

    const currentRank = getRank(mmr);

    for (const rank of ranks)
    {
        const element = document.createElement('div');
        element.className = 'rank-row';

        if (rank.name === currentRank)
            element.classList.add('current');

        element.innerHTML = `
            <strong>${rank.name}</strong>
            <span>${rank.mmr} MMR</span>
        `;

        rankList.appendChild(element);
    }
}

function getRank(mmr)
{
    let currentRank = ranks[0];

    for (const rank of ranks)
    {
        if (mmr >= rank.mmr)
            currentRank = rank;
    }

    return currentRank.name;
}

async function loadProfile()
{
    try
    {
        const response = await fetch('/api/me');

        if (!response.ok)
        {
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();
        const user = data.user;

        usernameElement.textContent = user.username || 'Unknown';
        emailElement.textContent = user.email;
        infoUsername.textContent = user.username || '—';
        infoEmail.textContent = user.email;

        const mmr = user.mmr || 0;
        mmrElement.textContent = `${mmr} MMR`;
        mmrElement.dataset.mmr = mmr;
        rankElement.textContent = getRank(mmr);

        infoId.textContent = user.id;
        infoOauth.textContent = user.oauth42Id ? 'Connected' : 'Not connected';
        const createdDate = new Date(user.createdAt);
        const day = String(createdDate.getDate()).padStart(2, '0');
        const month = String(createdDate.getMonth() + 1).padStart(2, '0');
        const year = createdDate.getFullYear();
        infoCreated.textContent = `${day}.${month}.${year}`;

        if (user.avatarUrl)
        {
            avatarElement.src = `${user.avatarUrl}?t=${Date.now()}`;
            avatarElement.classList.add('visible');
            avatarPlaceholder.classList.add('hidden');
            updateAvatarState(true);
        }
        else
        {
            avatarElement.removeAttribute('src');
            avatarElement.classList.remove('visible');
            avatarPlaceholder.classList.remove('hidden');
            updateAvatarState(false);
        }
    }
    catch (error)
    {
        console.error('Failed to load profile:', error);
        window.location.href = '/login.html';
    }
}

logoutButton.addEventListener('click', async () =>
{
    try
    {
        await fetch('/api/logout', { method: 'POST' });
    }
    finally
    {
        window.location.href = '/login.html';
    }
});

loadProfile();
loadMyAchievements();
