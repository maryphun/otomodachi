export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return Response.json(
        {
          success: false,
          error: 'API proxy is not configured yet',
        },
        { status: 501 },
      )
    }

    return env.ASSETS.fetch(request)
  },
}
