const SESSION_COOKIE_NAME = 'otomo_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
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

    if (url.pathname === '/auth/login') {
      return login_(request, env)
    }

    if (url.pathname === '/auth/logout') {
      return logout_()
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
      return proxyAppsScript_(url, env)
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
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
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
