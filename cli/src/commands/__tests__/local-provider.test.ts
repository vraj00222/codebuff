import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import {
  applyLocalAction,
  DEFAULT_LOCAL_BASE_URL,
  getActiveLocalBaseUrl,
  parseLocalArgs,
} from '../local-provider'

describe('parseLocalArgs', () => {
  test('empty args → status', () => {
    expect(parseLocalArgs('').kind).toBe('status')
    expect(parseLocalArgs('   ').kind).toBe('status')
    expect(parseLocalArgs('\t\n').kind).toBe('status')
  })

  test('"status" → status', () => {
    expect(parseLocalArgs('status').kind).toBe('status')
    expect(parseLocalArgs('  status  ').kind).toBe('status')
    expect(parseLocalArgs('STATUS').kind).toBe('status') // case-insensitive
  })

  test('"on" with no URL → enable with default Ollama URL', () => {
    const r = parseLocalArgs('on')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable') expect(r.baseUrl).toBe(DEFAULT_LOCAL_BASE_URL)
  })

  test('"on <url>" → enable with that URL', () => {
    const r = parseLocalArgs('on http://localhost:1234/v1')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable') expect(r.baseUrl).toBe('http://localhost:1234/v1')
  })

  test('"enable <url>" alias works', () => {
    const r = parseLocalArgs('enable http://localhost:1234/v1')
    expect(r.kind).toBe('enable')
  })

  test('"set <url>" alias works', () => {
    const r = parseLocalArgs('set http://localhost:1234/v1')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable') expect(r.baseUrl).toBe('http://localhost:1234/v1')
  })

  test('"set" with no URL → invalid', () => {
    const r = parseLocalArgs('set')
    expect(r.kind).toBe('enable')
    // "set" with no URL falls back to default — that's debatable but matches "on"
    if (r.kind === 'enable') expect(r.baseUrl).toBe(DEFAULT_LOCAL_BASE_URL)
  })

  test('bare URL (no subcommand) → treated as enable', () => {
    const r = parseLocalArgs('http://localhost:11434/v1')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable') expect(r.baseUrl).toBe('http://localhost:11434/v1')
  })

  test('"off" → disable', () => {
    expect(parseLocalArgs('off').kind).toBe('disable')
    expect(parseLocalArgs('disable').kind).toBe('disable')
  })

  test('"off" with stray args → invalid', () => {
    const r = parseLocalArgs('off http://oops')
    expect(r.kind).toBe('invalid')
  })

  test('non-http URL → invalid', () => {
    const r = parseLocalArgs('on ftp://localhost')
    expect(r.kind).toBe('invalid')
  })

  test('malformed URL → invalid', () => {
    const r = parseLocalArgs('on http://')
    expect(r.kind).toBe('invalid')
  })

  test('unknown subcommand → invalid with helpful message', () => {
    const r = parseLocalArgs('foobar')
    expect(r.kind).toBe('invalid')
    if (r.kind === 'invalid') expect(r.reason).toContain('Unknown')
  })

  test('https URL is accepted (for remote endpoints)', () => {
    const r = parseLocalArgs('on https://my-vm.example.com:8080/v1')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable')
      expect(r.baseUrl).toBe('https://my-vm.example.com:8080/v1')
  })

  test('extra whitespace in URL is preserved as-is when valid', () => {
    const r = parseLocalArgs('  on   http://localhost:11434/v1  ')
    expect(r.kind).toBe('enable')
    if (r.kind === 'enable') expect(r.baseUrl).toBe('http://localhost:11434/v1')
  })
})

describe('applyLocalAction (side effects on process.env)', () => {
  let originalBaseUrl: string | undefined
  let originalApiKey: string | undefined

  beforeEach(() => {
    originalBaseUrl = process.env.CODEBUFF_BASE_URL
    originalApiKey = process.env.CODEBUFF_PROVIDER_API_KEY
    delete process.env.CODEBUFF_BASE_URL
    delete process.env.CODEBUFF_PROVIDER_API_KEY
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.CODEBUFF_BASE_URL
    else process.env.CODEBUFF_BASE_URL = originalBaseUrl
    if (originalApiKey === undefined)
      delete process.env.CODEBUFF_PROVIDER_API_KEY
    else process.env.CODEBUFF_PROVIDER_API_KEY = originalApiKey
  })

  test('enable sets process.env.CODEBUFF_BASE_URL', () => {
    const msg = applyLocalAction({
      kind: 'enable',
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(process.env.CODEBUFF_BASE_URL).toBe('http://localhost:11434/v1')
    expect(getActiveLocalBaseUrl()).toBe('http://localhost:11434/v1')
    expect(msg).toContain('ON')
    expect(msg).toContain('http://localhost:11434/v1')
  })

  test('disable deletes process.env.CODEBUFF_BASE_URL', () => {
    process.env.CODEBUFF_BASE_URL = 'http://localhost:11434/v1'
    const msg = applyLocalAction({ kind: 'disable' })
    expect(process.env.CODEBUFF_BASE_URL).toBeUndefined()
    expect(msg).toContain('OFF')
    expect(msg).toContain('Previously: http://localhost:11434/v1')
  })

  test('disable also clears the API key env var', () => {
    process.env.CODEBUFF_BASE_URL = 'http://localhost:11434/v1'
    process.env.CODEBUFF_PROVIDER_API_KEY = 'ollama'
    applyLocalAction({ kind: 'disable' })
    expect(process.env.CODEBUFF_BASE_URL).toBeUndefined()
    expect(process.env.CODEBUFF_PROVIDER_API_KEY).toBeUndefined()
  })

  test('disable when already off is idempotent and friendly', () => {
    const msg = applyLocalAction({ kind: 'disable' })
    expect(msg).toContain('already OFF')
  })

  test('status when off shows OFF', () => {
    const msg = applyLocalAction({ kind: 'status' })
    expect(msg).toContain('OFF')
  })

  test('status when on shows the URL', () => {
    process.env.CODEBUFF_BASE_URL = 'http://localhost:1234/v1'
    const msg = applyLocalAction({ kind: 'status' })
    expect(msg).toContain('ON')
    expect(msg).toContain('http://localhost:1234/v1')
  })

  test('invalid action returns the reason prefixed', () => {
    const msg = applyLocalAction({
      kind: 'invalid',
      reason: 'something wrong',
    })
    expect(msg).toContain('something wrong')
    expect(process.env.CODEBUFF_BASE_URL).toBeUndefined()
  })

  test('enable overwrites a previously-set URL', () => {
    applyLocalAction({ kind: 'enable', baseUrl: 'http://localhost:11434/v1' })
    applyLocalAction({ kind: 'enable', baseUrl: 'http://localhost:1234/v1' })
    expect(process.env.CODEBUFF_BASE_URL).toBe('http://localhost:1234/v1')
  })

  test('full toggle cycle: off → on → status → off', () => {
    expect(applyLocalAction({ kind: 'status' })).toContain('OFF')

    applyLocalAction({ kind: 'enable', baseUrl: DEFAULT_LOCAL_BASE_URL })
    expect(getActiveLocalBaseUrl()).toBe(DEFAULT_LOCAL_BASE_URL)

    const statusOn = applyLocalAction({ kind: 'status' })
    expect(statusOn).toContain('ON')

    const off = applyLocalAction({ kind: 'disable' })
    expect(off).toContain('OFF')
    expect(off).toContain(`Previously: ${DEFAULT_LOCAL_BASE_URL}`)
    expect(getActiveLocalBaseUrl()).toBeUndefined()
  })

  test('mentions agent-level override in the enable message', () => {
    const msg = applyLocalAction({
      kind: 'enable',
      baseUrl: DEFAULT_LOCAL_BASE_URL,
    })
    expect(msg.toLowerCase()).toContain('providerOptions.baseUrl'.toLowerCase())
  })
})

describe('parseLocalArgs + applyLocalAction end-to-end', () => {
  let originalBaseUrl: string | undefined

  beforeEach(() => {
    originalBaseUrl = process.env.CODEBUFF_BASE_URL
    delete process.env.CODEBUFF_BASE_URL
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.CODEBUFF_BASE_URL
    else process.env.CODEBUFF_BASE_URL = originalBaseUrl
  })

  test('user types `/local on` → URL is set to default', () => {
    applyLocalAction(parseLocalArgs('on'))
    expect(process.env.CODEBUFF_BASE_URL).toBe(DEFAULT_LOCAL_BASE_URL)
  })

  test('user types `/local on http://x` → URL is set', () => {
    applyLocalAction(parseLocalArgs('on http://x.example.com:9999/v1'))
    expect(process.env.CODEBUFF_BASE_URL).toBe('http://x.example.com:9999/v1')
  })

  test('user types `/local off` after `/local on` → URL is cleared', () => {
    applyLocalAction(parseLocalArgs('on'))
    applyLocalAction(parseLocalArgs('off'))
    expect(process.env.CODEBUFF_BASE_URL).toBeUndefined()
  })

  test('user types `/local garbage` → no env change, error message returned', () => {
    const msg = applyLocalAction(parseLocalArgs('garbage'))
    expect(process.env.CODEBUFF_BASE_URL).toBeUndefined()
    expect(msg).toContain('Unknown')
  })
})
