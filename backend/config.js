const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env'), });
const config = 
{
    port: Number(process.env.PORT || 3000),
    
    intraAuthorizeUrl:
        'https://api.intra.42.fr/oauth/authorize',

    intraTokenUrl:
        'https://api.intra.42.fr/oauth/token',

    intraUserUrl:
        'https://api.intra.42.fr/v2/me',

    oauthStateCookieName:
        'transcendence_oauth_state',

    frontendUrl:
        process.env.FRONTEND_URL ||
        'http://localhost:8080',

    sessionSecret:
        process.env.SESSION_SECRET ||
        'dev-session-secret',

    sessionCookieName:
        'transcendence_session',

    intraClientId:
        process.env.INTRA_CLIENT_ID || '',

    intraClientSecret:
        process.env.INTRA_CLIENT_SECRET || '',

    intraRedirectUri:
        process.env.INTRA_REDIRECT_URI ||
        'https://localhost:8443/api/auth/42/callback',
};

module.exports = config;