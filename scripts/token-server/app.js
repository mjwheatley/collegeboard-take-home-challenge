import express from 'express';
import session from 'express-session';
import { Issuer, generators } from 'openid-client';
import { runIntegrationTests, getApiBase } from '../integration-test.js';
import fs from 'fs';
import path from 'path';

const app = express();

let client;

function getSstOutputs() {
  try {
    const outputsPath = path.join(process.cwd(), '.sst', 'outputs.json');
    return JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
  } catch (e) {
    console.error('Error reading .sst/outputs.json:', e.message);
    return {};
  }
}

// Initialize OpenID Client
async function initializeClient() {
  const outputs = getSstOutputs();
  const userPoolId = outputs.userPoolId;
  const clientId = outputs.userPoolClientId;
  const region = 'us-east-1';

  if (!userPoolId || !clientId) {
    console.error('Missing User Pool ID or Client ID in .sst/outputs.json');
    return;
  }

  const issuer = await Issuer.discover(`https://cognito-idp.${region}.amazonaws.com/${userPoolId}`);
  client = new issuer.Client({
    client_id: clientId,
    redirect_uris: ['http://localhost:3100/callback'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}
initializeClient().catch(console.error);

app.use(session({
  secret: 'some secret',
  resave: false,
  saveUninitialized: false,
}));

const checkAuth = (req, res, next) => {
  if (!req.session.userInfo) {
    req.isAuthenticated = false;
  } else {
    req.isAuthenticated = true;
  }
  next();
};

app.get('/', checkAuth, (req, res) => {
  res.render('home', {
    isAuthenticated: req.isAuthenticated,
    userInfo: req.session.userInfo,
    accessToken: req.session.accessToken,
  });
});

app.get('/login', (req, res) => {
  const nonce = generators.nonce();
  const state = generators.state();
  const code_verifier = generators.codeVerifier();
  const code_challenge = generators.codeChallenge(code_verifier);

  req.session.nonce = nonce;
  req.session.state = state;
  req.session.code_verifier = code_verifier;

  const authUrl = client.authorizationUrl({
    scope: 'aws.cognito.signin.user.admin email openid phone profile',
    state: state,
    nonce: nonce,
    code_challenge,
    code_challenge_method: 'S256',
  });

  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  try {
    const params = client.callbackParams(req);
    const tokenSet = await client.callback('http://localhost:3100/callback', params, {
      nonce: req.session.nonce,
      state: req.session.state,
      code_verifier: req.session.code_verifier,
    });

    const userInfo = await client.userinfo(tokenSet.access_token);
    req.session.userInfo = userInfo;
    req.session.accessToken = tokenSet.access_token;

    res.redirect('/');
  } catch (err) {
    console.error('Callback error:', err);
    res.redirect('/?error=callback_failed');
  }
});

app.get('/run-tests', checkAuth, async (req, res) => {
  if (!req.isAuthenticated) {
    return res.status(401).send('Unauthorized');
  }

  const apiBase = getApiBase();
  const token = req.session.accessToken;

  try {
    const result = await runIntegrationTests(apiBase, token);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  const outputs = getSstOutputs();
  const clientId = outputs.userPoolClientId;
  const cognitoDomain = process.env.COGNITO_DOMAIN;

  if (!cognitoDomain) {
    return res.status(500).send('COGNITO_DOMAIN environment variable is not configured');
  }

  req.session.destroy();
  const logoutUrl = `https://${cognitoDomain}.auth.us-east-1.amazonaws.com/logout?client_id=${clientId}&logout_uri=http://localhost:3100`;
  res.redirect(logoutUrl);
});

app.set('view engine', 'ejs');

app.listen(3100, () => {
  console.log('Token server running at http://localhost:3100');
});
