const SESSION_COOKIE_NAME = 'otomo_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const PRODUCTION_ORIGIN =
  'https://otomodachi.otopo.workers.dev'
const INTERNAL_QR_API_SECRET_HEADER =
  'x-otomo-qr-api-secret'
const TEXT_ENCODER = new TextEncoder()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders_(),
      })
    }

    if (url.pathname.startsWith('/public/customer/')) {
      return publicCustomerPage_(url, env)
    }

    if (url.pathname === '/otopo.png') {
      return env.ASSETS.fetch(request)
    }

    if (url.pathname === '/auth/login') {
      return login_(request, env)
    }

    if (url.pathname === '/auth/logout') {
      return logout_()
    }

    if (
      isQrProfileApiAction_(url) &&
      hasValidInternalQrApiSecret_(request, env)
    ) {
      return handleApi_(url, env, {
        skipLocalQrProxy: true,
      })
    }

    const isAuthenticated =
      await hasValidSession_(request, env)

    if (!isAuthenticated) {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return jsonResponse_(
          {
            success: false,
            error: 'ログインしてください',
          },
          401,
        )
      }

      return loginPage_()
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi_(url, env)
    }

    return env.ASSETS.fetch(request)
  },
}

async function login_(request, env) {
  if (request.method !== 'POST') {
    return loginPage_()
  }

  if (!env.AUTH_PIN || !env.AUTH_SESSION_SECRET) {
    return loginPage_('ログイン設定がまだ完了していません')
  }

  const formData = await request.formData()
  const pin = String(formData.get('pin') || '').trim()

  if (pin !== String(env.AUTH_PIN)) {
    return loginPage_('合言葉が違います')
  }

  const issuedAt = String(Date.now())
  const signature = await sign_(issuedAt, env.AUTH_SESSION_SECRET)
  const token = `${issuedAt}.${signature}`

  return new Response(null, {
    status: 303,
    headers: {
      location: '/',
      'set-cookie': [
        `${SESSION_COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      ].join('; '),
      'cache-control': 'no-store',
    },
  })
}

function logout_() {
  return new Response(null, {
    status: 303,
    headers: {
      location: '/',
      'set-cookie': [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Max-Age=0',
      ].join('; '),
      'cache-control': 'no-store',
    },
  })
}

async function hasValidSession_(request, env) {
  if (!env.AUTH_SESSION_SECRET) {
    return false
  }

  const token = getCookie_(
    request.headers.get('cookie') || '',
    SESSION_COOKIE_NAME,
  )
  const [issuedAt, signature] = String(token || '').split('.')
  const issuedAtNumber = Number(issuedAt)

  if (
    !issuedAt ||
    !signature ||
    !Number.isFinite(issuedAtNumber) ||
    Date.now() - issuedAtNumber > SESSION_MAX_AGE_SECONDS * 1000
  ) {
    return false
  }

  const expectedSignature = await sign_(
    issuedAt,
    env.AUTH_SESSION_SECRET,
  )

  return signature === expectedSignature
}

function getCookie_(cookieHeader, name) {
  const cookies = cookieHeader.split(';')

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=')

    if (key === name) {
      return valueParts.join('=')
    }
  }

  return ''
}

async function sign_(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    TEXT_ENCODER.encode(value),
  )

  return base64UrlEncode_(signature)
}

function base64UrlEncode_(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function loginPage_(errorMessage = '') {
  return new Response(
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>おともだちログイン</title>
    <style>
      :root {
        color: #10233a;
        background: #f4f7fa;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        place-items: center;
      }

      main {
        width: min(420px, calc(100vw - 32px));
        padding: 32px;
        background: #fff;
        border: 1px solid #d9e2ec;
        border-radius: 18px;
        box-shadow: 0 18px 42px rgb(16 35 58 / 12%);
      }

      .eyebrow {
        margin: 0 0 8px;
        color: #15395d;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .12em;
      }

      h1 {
        margin: 0 0 24px;
        font-size: 32px;
      }

      label {
        display: block;
        margin-bottom: 10px;
        color: #637083;
        font-size: 13px;
        font-weight: 800;
      }

      input {
        box-sizing: border-box;
        width: 100%;
        height: 64px;
        padding: 0 18px;
        color: #10233a;
        background: #edf5fc;
        border: 1px solid #d5e0ea;
        border-radius: 16px;
        font-size: 28px;
        font-weight: 800;
      }

      button {
        width: 100%;
        height: 58px;
        margin-top: 18px;
        color: #fff;
        background: #173754;
        border: 0;
        border-radius: 16px;
        font-size: 17px;
        font-weight: 900;
        cursor: pointer;
      }

      .error {
        margin: 16px 0 0;
        padding: 13px 15px;
        color: #ad2435;
        background: #fff0f2;
        border-radius: 12px;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">OTOMODACHI</p>
      <h1>合言葉</h1>
      <form method="post" action="/auth/login">
        <label for="pin">スタッフ用</label>
        <input id="pin" name="pin" type="password" autocomplete="current-password" autofocus>
        <button type="submit">入る</button>
      </form>
      ${errorMessage ? `<p class="error">${escapeHtml_(errorMessage)}</p>` : ''}
    </main>
  </body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

function escapeHtml_(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function publicCustomerPage_(requestUrl, env) {
  const token = getPublicCustomerTokenFromPath_(
    requestUrl.pathname,
  )

  if (!token) {
    return publicCustomerErrorPage_('公開QRが無効です')
  }

  let result

  try {
    result = await getPublicCustomerByToken_(
      env,
      token,
    )
  } catch (error) {
    console.error(error)
    return publicCustomerErrorPage_(
      error.message || '個人QRコードを確認できませんでした',
    )
  }

  if (!result.success) {
    return publicCustomerErrorPage_(
      result.error || '公開QRが無効です',
    )
  }

  const customer = result.data || {}
  const customerName = escapeHtml_(
    displayPublicCustomerName_(customer.customerName),
  )
  const code = escapeHtml_(customer.customerCode || '')
  const balance = escapeHtml_(
    formatPublicNumber_(customer.currentBalance),
  )
  const lastVisit = escapeHtml_(
    customer.lastVisit || '記録なし',
  )

  return new Response(
    `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${customerName} | おともだちポーカー</title>
  <link rel="icon" type="image/png" href="/otopo.png">
  <style>
    :root {
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #101923;
      background: #f4f7fa;
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100dvh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 18px;
      background:
        radial-gradient(circle at 18% 8%, rgb(221 237 249 / 82%), transparent 34%),
        linear-gradient(135deg, #f7fbff, #edf3f8 48%, #fff7f0);
    }

    main {
      width: min(100%, 440px);
      display: grid;
      gap: 16px;
    }

    .card {
      padding: 24px;
      background: rgb(255 255 255 / 88%);
      border: 1px solid rgb(23 50 77 / 10%);
      border-radius: 28px;
      box-shadow: 0 18px 46px rgb(15 34 53 / 13%);
      backdrop-filter: blur(12px);
    }

    .eyebrow {
      margin: 0 0 8px;
      color: #173754;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .12em;
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 9vw, 46px);
      line-height: 1.12;
      letter-spacing: 0;
    }

    .suffix {
      margin-left: 6px;
      color: #758291;
      font-size: .48em;
      font-weight: 800;
      vertical-align: .18em;
    }

    .code {
      display: inline-grid;
      place-items: center;
      min-width: 58px;
      min-height: 32px;
      margin-bottom: 14px;
      padding: 6px 12px;
      color: #0d3a61;
      background: #eaf4fc;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 850;
    }

    .balance {
      margin-top: 22px;
      padding: 18px;
      color: white;
      background: #d4238a;
      border-radius: 24px;
      box-shadow: 0 12px 28px rgb(212 35 138 / 22%);
    }

    .balance span,
    .meta span {
      display: block;
      color: rgb(255 255 255 / 74%);
      font-size: 13px;
      font-weight: 750;
    }

    .balance strong {
      display: block;
      margin-top: 6px;
      font-size: clamp(46px, 15vw, 70px);
      line-height: 1;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
    }

    .balance small {
      display: block;
      margin-top: 7px;
      color: rgb(255 255 255 / 74%);
      font-size: 13px;
      font-weight: 700;
    }

    .meta {
      display: grid;
      gap: 10px;
      padding: 18px;
      background: rgb(255 255 255 / 72%);
      border: 1px solid rgb(23 50 77 / 9%);
      border-radius: 22px;
    }

    .meta div {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      color: #101923;
      font-size: 15px;
      font-weight: 850;
    }

    .meta span {
      color: #758291;
    }

    .notice {
      margin: 0;
      color: #667483;
      font-size: 12px;
      line-height: 1.7;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <span class="code">${code}</span>
      <h1>${customerName}<span class="suffix">さん</span></h1>
      <div class="balance">
        <span>現在のうにょ</span>
        <strong>${balance}</strong>
        <small>うにょ</small>
      </div>
    </section>
    <section class="meta">
      <div><span>最終来店日</span><strong>${lastVisit}</strong></div>
    </section>
    <p class="notice">
      公開停止したい場合はお店のスタッフにお願いしてください！
    </p>
  </main>
</body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

async function handleApi_(requestUrl, env, options = {}) {
  const action = requestUrl.searchParams.get('action') || ''

  try {
    if (
      !options.skipLocalQrProxy &&
      isLocalRequestHost_(requestUrl.hostname) &&
      isQrProfileApiAction_(requestUrl)
    ) {
      return proxyProductionQrApi_(requestUrl, env)
    }

    if (action === 'getCustomerPublicProfile') {
      return jsonResponse_(
        await getCustomerPublicProfile_(
          env,
          requestUrl.searchParams.get('customerCode'),
        ),
      )
    }

    if (action === 'updateCustomerProfilePublic') {
      return jsonResponse_(
        await updateCustomerPublicProfile_(
          env,
          requestUrl.searchParams.get('customerCode'),
          requestUrl.searchParams.get('profilePublic') === 'true',
        ),
      )
    }
  } catch (error) {
    console.error(error)

    return jsonResponse_(
      {
        success: false,
        error:
          error.message ||
          '個人QRコードの確認に失敗しました',
      },
      500,
    )
  }

  return proxyAppsScript_(requestUrl, env)
}

function isQrProfileApiAction_(requestUrl) {
  if (
    requestUrl.pathname !== '/api' &&
    !requestUrl.pathname.startsWith('/api/')
  ) {
    return false
  }

  return [
    'getCustomerPublicProfile',
    'updateCustomerProfilePublic',
  ].includes(requestUrl.searchParams.get('action') || '')
}

function isLocalRequestHost_(hostname) {
  return [
    'localhost',
    '127.0.0.1',
  ].includes(hostname)
}

function hasValidInternalQrApiSecret_(request, env) {
  if (!env.APPS_SCRIPT_SECRET) {
    return false
  }

  return (
    request.headers.get(INTERNAL_QR_API_SECRET_HEADER) ===
    env.APPS_SCRIPT_SECRET
  )
}

async function proxyProductionQrApi_(requestUrl, env) {
  if (!env.APPS_SCRIPT_SECRET) {
    return jsonResponse_(
      {
        success: false,
        error: 'QR API secret is not configured',
      },
      500,
    )
  }

  const targetUrl = new URL('/api', PRODUCTION_ORIGIN)

  for (const key of [
    'action',
    'customerCode',
    'profilePublic',
  ]) {
    const value = requestUrl.searchParams.get(key)

    if (value !== null) {
      targetUrl.searchParams.set(key, value)
    }
  }

  const response = await fetch(targetUrl.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      [INTERNAL_QR_API_SECRET_HEADER]:
        env.APPS_SCRIPT_SECRET,
    },
  })

  const body = await response.text()

  return new Response(body, {
    status: response.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function getCustomerPublicProfile_(env, customerCode) {
  const code = normalizePublicCustomerCode_(customerCode)

  if (!code) {
    return {
      success: false,
      error: 'おともだちNo.が空です',
    }
  }

  const db = getQrDatabase_(env)
  await ensurePublicProfileSchema_(db)

  const row = await db
    .prepare(
      [
        'SELECT token, enabled',
        'FROM public_customer_profiles',
        'WHERE customer_code = ?',
      ].join(' '),
    )
    .bind(code)
    .first()

  const profilePublic = Boolean(row && Number(row.enabled) === 1)

  return {
    success: true,
    data: {
      customerCode: code,
      profilePublic,
      publicToken: profilePublic ? String(row.token || '') : '',
    },
  }
}

async function updateCustomerPublicProfile_(
  env,
  customerCode,
  profilePublic,
) {
  const code = normalizePublicCustomerCode_(customerCode)

  if (!code) {
    return {
      success: false,
      error: 'おともだちNo.が空です',
    }
  }

  const customerResult = await fetchAppsScriptJson_(
    {
      action: 'getCustomer',
      customerCode: code,
    },
    env,
  )

  if (!customerResult.success) {
    return customerResult
  }

  const db = getQrDatabase_(env)
  const timestamp = new Date().toISOString()

  await ensurePublicProfileSchema_(db)

  if (!profilePublic) {
    await db
      .prepare(
        [
          'UPDATE public_customer_profiles',
          'SET enabled = 0, updated_at = ?, revoked_at = ?',
          'WHERE customer_code = ?',
        ].join(' '),
      )
      .bind(timestamp, timestamp, code)
      .run()

    return {
      success: true,
      data: {
        customerCode: code,
        profilePublic: false,
        publicToken: '',
      },
    }
  }

  const existing = await db
    .prepare(
      [
        'SELECT token, enabled',
        'FROM public_customer_profiles',
        'WHERE customer_code = ?',
      ].join(' '),
    )
    .bind(code)
    .first()

  if (existing && Number(existing.enabled) === 1) {
    return {
      success: true,
      data: {
        customerCode: code,
        profilePublic: true,
        publicToken: String(existing.token || ''),
      },
    }
  }

  const token = await createUniquePublicToken_(db)

  await db
    .prepare(
      [
        'INSERT INTO public_customer_profiles',
        '(customer_code, token, enabled, created_at, updated_at, revoked_at)',
        'VALUES (?, ?, 1, ?, ?, NULL)',
        'ON CONFLICT(customer_code) DO UPDATE SET',
        'token = excluded.token,',
        'enabled = 1,',
        'updated_at = excluded.updated_at,',
        'revoked_at = NULL',
      ].join(' '),
    )
    .bind(code, token, timestamp, timestamp)
    .run()

  return {
    success: true,
    data: {
      customerCode: code,
      profilePublic: true,
      publicToken: token,
    },
  }
}

async function getPublicCustomerByToken_(env, publicToken) {
  const token = normalizePublicToken_(publicToken)

  if (!token) {
    return {
      success: false,
      error: '個人QRコードが無効です',
    }
  }

  const db = getQrDatabase_(env)
  await ensurePublicProfileSchema_(db)

  const row = await db
    .prepare(
      [
        'SELECT customer_code',
        'FROM public_customer_profiles',
        'WHERE token = ? AND enabled = 1',
      ].join(' '),
    )
    .bind(token)
    .first()

  if (!row?.customer_code) {
    return {
      success: false,
      error: '個人QRコードが無効です',
    }
  }

  return fetchAppsScriptJson_(
    {
      action: 'getCustomer',
      customerCode: row.customer_code,
    },
    env,
  )
}

function getQrDatabase_(env) {
  if (!env.QR_DB) {
    throw new Error('QR database is not configured')
  }

  return env.QR_DB
}

async function ensurePublicProfileSchema_(db) {
  await db
    .prepare(
      [
        'CREATE TABLE IF NOT EXISTS public_customer_profiles (',
        'customer_code TEXT PRIMARY KEY,',
        'token TEXT NOT NULL UNIQUE,',
        'enabled INTEGER NOT NULL DEFAULT 1,',
        'created_at TEXT NOT NULL,',
        'updated_at TEXT NOT NULL,',
        'revoked_at TEXT',
        ')',
      ].join(' '),
    )
    .run()

  await db
    .prepare(
      [
        'CREATE INDEX IF NOT EXISTS idx_public_customer_profiles_token',
        'ON public_customer_profiles (token)',
      ].join(' '),
    )
    .run()
}

async function createUniquePublicToken_(db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]
      .join('')
      .replaceAll('-', '')

    const existing = await db
      .prepare(
        [
          'SELECT customer_code',
          'FROM public_customer_profiles',
          'WHERE token = ?',
        ].join(' '),
      )
      .bind(token)
      .first()

    if (!existing) {
      return token
    }
  }

  throw new Error('個人QRコードの作成に失敗しました')
}

function normalizePublicCustomerCode_(value) {
  const text = String(value || '').trim()

  if (!text) {
    return ''
  }

  const digits = text.replace(/[^0-9]/g, '')

  return digits ? digits.padStart(4, '0') : text
}

function normalizePublicToken_(value) {
  return String(value || '')
    .trim()
    .replace(/[^0-9A-Za-z_-]/g, '')
}

function publicCustomerErrorPage_(message) {
  const escapedMessage = escapeHtml_(message)

  return new Response(
    `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>個人QRコード</title>
  <style>
    body {
      min-height: 100dvh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 18px;
      color: #101923;
      background: #f4f7fa;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(100%, 420px);
      padding: 24px;
      background: white;
      border: 1px solid rgb(23 50 77 / 10%);
      border-radius: 24px;
      box-shadow: 0 18px 46px rgb(15 34 53 / 13%);
      text-align: center;
    }

    h1 {
      margin: 0 0 10px;
      font-size: 26px;
    }

    p {
      margin: 0;
      color: #9a3039;
      font-weight: 800;
    }
  </style>
</head>
<body>
  <main>
    <h1>個人QRコード</h1>
    <p>${escapedMessage}</p>
  </main>
</body>
</html>`,
    {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

function getPublicCustomerTokenFromPath_(pathname) {
  const prefix = '/public/customer/'
  const rawToken = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).split('/')[0]
    : ''

  try {
    return decodeURIComponent(rawToken)
  } catch {
    return ''
  }
}

function displayPublicCustomerName_(value) {
  return String(value || '').replace(/さん\s*$/, '')
}

function formatPublicNumber_(value) {
  const number = Number(value || 0)
  return Number.isFinite(number)
    ? number.toLocaleString('ja-JP')
    : '0'
}

async function fetchAppsScriptJson_(parameters, env) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    return {
      success: false,
      error: 'API proxy is not configured',
    }
  }

  const targetUrl = new URL(env.APPS_SCRIPT_URL)

  for (const [key, value] of Object.entries(parameters)) {
    targetUrl.searchParams.set(key, String(value))
  }

  targetUrl.searchParams.set(
    'apiSecret',
    env.APPS_SCRIPT_SECRET,
  )

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })
    const text = await response.text()

    return JSON.parse(text)
  } catch (error) {
    console.error(error)

    return {
      success: false,
      error: 'サーバーに接続できませんでした',
    }
  }
}

async function proxyAppsScript_(requestUrl, env) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    return jsonResponse_(
      {
        success: false,
        error: 'API proxy is not configured',
      },
      500,
    )
  }

  const targetUrl = new URL(env.APPS_SCRIPT_URL)

  for (const [key, value] of requestUrl.searchParams) {
    targetUrl.searchParams.set(key, value)
  }

  targetUrl.searchParams.set(
    'apiSecret',
    env.APPS_SCRIPT_SECRET,
  )

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })
    const text = await response.text()

    return new Response(text, {
      status: response.ok ? 200 : response.status,
      headers: {
        ...getCorsHeaders_(),
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error(error)

    return jsonResponse_(
      {
        success: false,
        error: 'サーバーに接続できませんでした',
      },
      502,
    )
  }
}

function jsonResponse_(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...getCorsHeaders_(),
      'cache-control': 'no-store',
    },
  })
}

function getCorsHeaders_() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}
