// Channel name to webhook URL, and the post itself.
//
// The rest of the system talks about 'new_sale' and never about a URL. Only
// this file knows the secrets exist, so adding a fourth channel is a secret
// and one line here rather than a change anywhere that sends.

import type { Channel } from './messages.ts'

const SECRET_BY_CHANNEL: Record<Channel, string> = {
  new_sale: 'SLACK_WEBHOOK_NEW_SALE',
  scheduling: 'SLACK_WEBHOOK_SCHEDULING',
  stock: 'SLACK_WEBHOOK_STOCK',
}

export function secretNameFor(channel: Channel): string {
  return SECRET_BY_CHANNEL[channel]
}

export function webhookFor(channel: Channel): string {
  const key = SECRET_BY_CHANNEL[channel]
  if (!key) return ''
  return (Deno.env.get(key) || '').trim()
}

// Which channels are actually configured. Used by the health check, so an
// unset secret is something you can find out before a signature does.
export function configuredChannels(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const channel of Object.keys(SECRET_BY_CHANNEL) as Channel[]) {
    out[channel] = Boolean(webhookFor(channel))
  }
  return out
}

export type PostResult = { ok: true } | { ok: false; error: string }

/**
 * Posts one message to one channel.
 *
 * Slack answers an incoming webhook with the literal string "ok" and a 200, or
 * a 4xx with a reason in the body. Both are reported here rather than thrown,
 * because the caller has a notifications row open and needs to record which
 * one happened either way.
 *
 * mrkdwn is left on. The messages use bold and links, and turning it off would
 * print the angle brackets rather than the link.
 */
export async function postToSlack(
  channel: Channel, message: string, timeoutMs = 8000,
): Promise<PostResult> {
  const url = webhookFor(channel)

  if (!url) {
    return {
      ok: false,
      error: `${SECRET_BY_CHANNEL[channel]} is not set on this project, so the `
        + `${channel} channel has nowhere to post.`,
    }
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, mrkdwn: true }),
      signal: abort.signal,
    })

    const body = (await res.text().catch(() => '')).trim()

    if (!res.ok) {
      // Slack puts the useful part in the body: invalid_payload, no_service,
      // channel_not_found. The status alone does not say which.
      return { ok: false, error: `Slack returned ${res.status}${body ? `, ${body}` : ''}.` }
    }

    return { ok: true }
  } catch (caught) {
    const err = caught as Error
    if (err?.name === 'AbortError') {
      return { ok: false, error: `Slack did not answer within ${timeoutMs}ms.` }
    }
    return { ok: false, error: `Slack could not be reached. ${err?.message || String(caught)}` }
  } finally {
    clearTimeout(timer)
  }
}
