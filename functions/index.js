const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const OAuthClient = require('intuit-oauth')
const crypto = require('crypto')

initializeApp()
const db = getFirestore()

// Functions run in us-central1 by default; keep close to your Firestore region
setGlobalOptions({ region: 'us-central1', maxInstances: 10 })

const QBO_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com'
const QBO_BASE_PROD = 'https://quickbooks.api.intuit.com'

// ─── Helpers ─────────────────────────────────────────────────────────
function newOAuthClient(redirectUri) {
  return new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: process.env.QBO_ENV || 'sandbox',
    redirectUri,
  })
}

function requireAuth(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Must be signed in')
  return req.auth
}

// ─── qboAuthUrl ──────────────────────────────────────────────────────
// Returns the Intuit authorization URL + a one-time state token.
// Frontend redirects to this URL. After auth, Intuit redirects back to
// the configured redirect URI with ?code=...&realmId=...&state=...
exports.qboAuthUrl = onCall(async (req) => {
  const auth = requireAuth(req)
  const useDev = req.data?.useDev === true
  const redirectUri = useDev
    ? process.env.QBO_REDIRECT_DEV
    : process.env.QBO_REDIRECT_PROD

  const state = crypto.randomBytes(16).toString('hex')
  await db.collection('qboState').doc(state).set({
    userId: auth.uid,
    redirectUri,
    createdAt: new Date().toISOString(),
  })

  const oauth = newOAuthClient(redirectUri)
  const url = oauth.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state,
  })
  return { url, state }
})

// ─── qboExchangeCode ─────────────────────────────────────────────────
// Frontend calls this from /qbo-callback after Intuit redirects back.
// Exchanges the temporary code for access + refresh tokens.
exports.qboExchangeCode = onCall(async (req) => {
  const auth = requireAuth(req)
  const { code, realmId, state } = req.data || {}
  if (!code || !realmId || !state) {
    throw new HttpsError('invalid-argument', 'Missing code, realmId, or state')
  }

  const stateDoc = await db.collection('qboState').doc(state).get()
  if (!stateDoc.exists) throw new HttpsError('permission-denied', 'Invalid state token')
  const stateData = stateDoc.data()

  const oauth = newOAuthClient(stateData.redirectUri)
  const fakeUrl = `${stateData.redirectUri}?code=${encodeURIComponent(code)}&state=${state}&realmId=${realmId}`
  let tokenResponse
  try {
    tokenResponse = await oauth.createToken(fakeUrl)
  } catch (err) {
    console.error('createToken failed:', err)
    throw new HttpsError('internal', 'Token exchange failed: ' + (err?.message || 'unknown'))
  }
  const token = tokenResponse.getJson()

  // Fetch company name for display
  let companyName = 'Unknown'
  try {
    const base = oauth.environment === 'sandbox' ? QBO_BASE_SANDBOX : QBO_BASE_PROD
    const info = await oauth.makeApiCall({
      url: `${base}/v3/company/${realmId}/companyinfo/${realmId}`,
    })
    companyName = info.json?.CompanyInfo?.CompanyName || companyName
  } catch (err) {
    console.warn('Could not fetch company name:', err?.message)
  }

  await db.collection('qboConnections').doc('main').set({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + token.x_refresh_token_expires_in * 1000).toISOString(),
    environment: process.env.QBO_ENV || 'sandbox',
    companyName,
    connectedAt: new Date().toISOString(),
    connectedBy: auth.uid,
  })

  await db.collection('qboState').doc(state).delete()
  return { success: true, companyName, realmId }
})

// ─── qboStatus ───────────────────────────────────────────────────────
// Returns whether QBO is connected and the company name.
// Does NOT return tokens — those stay server-side only.
exports.qboStatus = onCall(async (req) => {
  requireAuth(req)
  const doc = await db.collection('qboConnections').doc('main').get()
  if (!doc.exists) return { connected: false }
  const d = doc.data()
  return {
    connected: true,
    companyName: d.companyName,
    realmId: d.realmId,
    environment: d.environment,
    connectedAt: d.connectedAt,
    expiresAt: d.expiresAt,
  }
})

// ─── qboDisconnect ───────────────────────────────────────────────────
// Revokes tokens with Intuit and clears Firestore connection doc.
exports.qboDisconnect = onCall(async (req) => {
  requireAuth(req)
  const docRef = db.collection('qboConnections').doc('main')
  const doc = await docRef.get()
  if (!doc.exists) return { success: true, alreadyDisconnected: true }

  const d = doc.data()
  try {
    const oauth = newOAuthClient(process.env.QBO_REDIRECT_PROD)
    oauth.setToken({
      access_token: d.accessToken,
      refresh_token: d.refreshToken,
    })
    await oauth.revoke()
  } catch (err) {
    console.warn('Token revoke failed (continuing anyway):', err?.message)
  }

  await docRef.delete()
  return { success: true }
})
