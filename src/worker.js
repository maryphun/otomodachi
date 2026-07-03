export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders_(),
      })
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyAppsScript_(url, env)
    }

    return env.ASSETS.fetch(request)
  },
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
