// GET /api/me: the current user (id, email) or 401.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { error, fromException, json } from '../shared/http'
import { validateSession } from '../shared/session'
import type { MeResponse } from '../shared/types'

export async function me(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    return json<MeResponse>({ user: { id: user.id, email: user.email } })
  } catch (err) {
    return fromException(err)
  }
}

app.http('me', {
  route: 'me',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: me,
})
