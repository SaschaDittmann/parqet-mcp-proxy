import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file if present
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}
const CREDENTIALS_DIR = join(__dirname, '..', 'credentials');
const TOKENS_FILE = join(CREDENTIALS_DIR, 'tokens.json');

const CLIENT_ID = process.env.PARQET_CLIENT_ID || '01a06bb9-9f2a-7025-8c5f-e7ad2a0fbeef';
const AUTH_URL = 'https://connect.parqet.com/oauth2/authorize';
const TOKEN_URL = 'https://connect.parqet.com/oauth2/token';
const SCOPE = 'portfolio:read';
const CALLBACK_PORT = 18392;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function loadTokens() {
  try {
    const data = await readFile(TOKENS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveTokens(tokens) {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(tokens);
  return tokens;
}

export async function getValidAccessToken() {
  let tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated. Run: node src/auth.js');
  }

  if (tokens.expires_at && Date.now() > tokens.expires_at - 60_000) {
    tokens = await refreshAccessToken(tokens.refresh_token);
  }

  return tokens.access_token;
}

export async function authenticate() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('base64url');

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>State mismatch</h1><p>Possible CSRF attack. Please try again.</p></body></html>');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        return;
      }

      try {
        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        });

        const tokenResponse = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!tokenResponse.ok) {
          const errBody = await tokenResponse.text();
          throw new Error(`Token exchange failed (${tokenResponse.status}): ${errBody}`);
        }

        const data = await tokenResponse.json();
        const tokens = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        };
        await saveTokens(tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authenticated with Parqet!</h1><p>You can close this window.</p></body></html>');
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
        server.close();
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      const url = authUrl.toString();
      console.error(`\nOpen this URL to authenticate with Parqet:\n\n  ${url}\n`);

      try {
        if (process.platform === 'darwin') {
          execSync(`open "${url}"`);
        } else if (process.platform === 'linux') {
          execSync(`xdg-open "${url}"`);
        } else if (process.platform === 'win32') {
          execSync(`start "" "${url}"`);
        }
      } catch {
        // User will need to open the URL manually
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out after 5 minutes'));
    }, 300_000);
  });
}

// Run standalone for initial authentication
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    await authenticate();
    console.error('Authentication successful! Tokens saved to credentials/tokens.json');
    process.exit(0);
  } catch (err) {
    console.error('Authentication failed:', err.message);
    process.exit(1);
  }
}
