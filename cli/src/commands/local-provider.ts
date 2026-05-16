/**
 * /local slash command — runtime toggle for the custom OpenAI-compatible
 * provider (Ollama, LM Studio, self-hosted).
 *
 * Mutates process.env.CODEBUFF_BASE_URL at runtime. The SDK reads this lazily
 * on every promptAiSdkStream call, so changes take effect immediately for the
 * next request without needing to rebuild the CodebuffClient.
 *
 * Subcommands:
 *   /local                   — show current status
 *   /local on                — enable with default Ollama URL
 *   /local on <url>          — enable with a specific URL
 *   /local set <url>         — alias for `/local on <url>`
 *   /local off               — disable, return to Codebuff backend
 *   /local status            — same as `/local`
 *
 * Agent-level providerOptions.baseUrl always wins; /local only affects agents
 * that don't set their own baseUrl.
 */

import {
  PROVIDER_API_KEY_ENV_VAR,
  PROVIDER_BASE_URL_ENV_VAR,
} from '@codebuff/common/constants/custom-provider'

/** Default URL used by `/local on` when the user doesn't specify one. */
export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1'

export type LocalCommandAction =
  | { kind: 'status' }
  | { kind: 'enable'; baseUrl: string }
  | { kind: 'disable' }
  | { kind: 'invalid'; reason: string }

/**
 * Parse the args passed to `/local`. Pure function — no side effects.
 * Exported for unit testing.
 */
export function parseLocalArgs(rawArgs: string): LocalCommandAction {
  const trimmed = rawArgs.trim()

  // No args → show status
  if (!trimmed) {
    return { kind: 'status' }
  }

  const [subcommand, ...rest] = trimmed.split(/\s+/)
  const sub = subcommand.toLowerCase()
  const value = rest.join(' ').trim()

  if (sub === 'status') {
    return { kind: 'status' }
  }

  if (sub === 'off' || sub === 'disable') {
    if (value) {
      return {
        kind: 'invalid',
        reason: `\`/local ${sub}\` does not take arguments. Got: "${value}"`,
      }
    }
    return { kind: 'disable' }
  }

  if (sub === 'on' || sub === 'enable' || sub === 'set') {
    const url = value || DEFAULT_LOCAL_BASE_URL
    const validated = validateBaseUrl(url)
    if (!validated.ok) {
      return { kind: 'invalid', reason: validated.reason }
    }
    return { kind: 'enable', baseUrl: validated.url }
  }

  // Looks like a bare URL (e.g. `/local http://localhost:11434/v1`)?
  // Be friendly — treat it as `/local on <url>`.
  if (sub.startsWith('http://') || sub.startsWith('https://')) {
    const validated = validateBaseUrl(trimmed)
    if (!validated.ok) {
      return { kind: 'invalid', reason: validated.reason }
    }
    return { kind: 'enable', baseUrl: validated.url }
  }

  return {
    kind: 'invalid',
    reason: `Unknown /local subcommand: "${subcommand}". Try: on, off, status, or set <url>.`,
  }
}

function validateBaseUrl(
  raw: string,
):
  | { ok: true; url: string }
  | { ok: false; reason: string } {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: 'URL is required.' }
  }
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return {
      ok: false,
      reason: `URL must start with http:// or https://. Got: "${raw}"`,
    }
  }
  try {
    // eslint-disable-next-line no-new
    new URL(raw)
  } catch {
    return { ok: false, reason: `Invalid URL: "${raw}"` }
  }
  return { ok: true, url: raw }
}

/**
 * Read the currently-active local provider URL (or undefined if disabled).
 * Reads from process.env so it reflects both shell-set values and /local-set values.
 */
export function getActiveLocalBaseUrl(): string | undefined {
  return process.env[PROVIDER_BASE_URL_ENV_VAR]
}

/**
 * Apply an action to process.env. Returns a user-facing message describing what happened.
 * Side effects are isolated to this function for testability.
 */
export function applyLocalAction(action: LocalCommandAction): string {
  if (action.kind === 'invalid') {
    return `❌ ${action.reason}`
  }

  if (action.kind === 'status') {
    const current = getActiveLocalBaseUrl()
    if (!current) {
      return [
        'Local provider: OFF',
        '',
        'All agents (without per-agent providerOptions.baseUrl) go through the Codebuff backend.',
        '',
        'Enable with: /local on   (defaults to ' + DEFAULT_LOCAL_BASE_URL + ')',
      ].join('\n')
    }
    return [
      `Local provider: ON`,
      `  URL: ${current}`,
      '',
      'Agents without their own providerOptions.baseUrl will use this endpoint.',
      'Disable with: /local off',
    ].join('\n')
  }

  if (action.kind === 'enable') {
    process.env[PROVIDER_BASE_URL_ENV_VAR] = action.baseUrl
    return [
      `Local provider: ON`,
      `  URL: ${action.baseUrl}`,
      '',
      'Note: agents with their own `providerOptions.baseUrl` still win.',
      'Disable with: /local off',
    ].join('\n')
  }

  // action.kind === 'disable'
  const wasSet = getActiveLocalBaseUrl()
  delete process.env[PROVIDER_BASE_URL_ENV_VAR]
  delete process.env[PROVIDER_API_KEY_ENV_VAR]
  if (!wasSet) {
    return 'Local provider was already OFF. No change.'
  }
  return [
    'Local provider: OFF',
    `  Previously: ${wasSet}`,
    '',
    'Routing returns to the Codebuff backend.',
  ].join('\n')
}
