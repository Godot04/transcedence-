const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const oauth42Button = document.getElementById('oauth-42-button');
const message = document.getElementById('message');

function showMessage(text, error = false)
{
    if (!message)
        return;

    message.textContent = text;
    message.classList.toggle('error', error);
}

async function submitAuth(url, payload)
{
    const response = await fetch(url,
    {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const type = response.headers.get('content-type') || '';
    let data = {};

    if (type.includes('application/json'))
        data = await response.json();
    else
        throw new Error(`Server returned HTTP ${response.status}`);

    if (!response.ok)
        throw new Error(data.error || 'Request failed');

    return data;
}

if (loginForm)
{
    loginForm.addEventListener('submit', async (event) =>
    {
        event.preventDefault();

        const identifier = loginForm.identifier.value.trim();
        const password = loginForm.password.value;

        showMessage('Logging in...');

        try
        {
            await submitAuth('/api/login', {
                identifier,
                password,
            });

            window.location.href = '/profile.html';
        }
        catch (error)
        {
            showMessage(`Login failed: ${error.message}`, true);
        }
    });
}

if (registerForm)
{
    registerForm.addEventListener('submit', async (event) =>
    {
        event.preventDefault();

        const username = registerForm.username.value.trim();
        const email = registerForm.email.value.trim();
        const password = registerForm.password.value;

        showMessage('Creating account...');

        try
        {
            await submitAuth('/api/register', {
                username,
                email,
                password,
            });

            window.location.href = '/login.html?registered=1';
        }
        catch (error)
        {
            showMessage(`Registration failed: ${error.message}`, true);
        }
    });
}

if (oauth42Button)
{
    oauth42Button.addEventListener('click', () =>
    {
        window.location.href = '/api/auth/42/start';
    });
}

const params = new URLSearchParams(window.location.search);

if (params.get('registered') === '1')
    showMessage('Account created successfully. Please log in.');

if (params.get('auth') === '42-error')
    showMessage('42 authentication failed. Please try again.', true);
