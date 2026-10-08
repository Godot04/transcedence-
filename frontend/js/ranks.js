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