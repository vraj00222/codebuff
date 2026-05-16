#!/usr/bin/env bun
/**
 * Smoke test for issue #678 — local OpenAI-compatible provider support.
 *
 * Verifies the new code paths end-to-end against a running Ollama instance:
 *   1. getModelForRequest(customProvider: {...}) returns isCustomProvider: true
 *   2. The returned model successfully streams from http://localhost:11434/v1
 *   3. When Ollama is unreachable, the friendly error wrapping fires
 *   4. The env-var fallback works (CODEBUFF_BASE_URL)
 *
 * Run: bun scripts/smoke-test-custom-provider.ts
 */

import { streamText } from 'ai'

import { getModelForRequest } from '../sdk/src/impl/model-provider'

const MODEL = 'llama3.1:8b'
const BASE_URL = 'http://localhost:11434/v1'

function header(s: string) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`)
}

async function streamAndCollect(model: any, prompt: string): Promise<string> {
  const response = streamText({
    model,
    messages: [{ role: 'user', content: prompt }],
    maxRetries: 1,
  })
  let out = ''
  for await (const chunk of response.fullStream) {
    if (chunk.type === 'text-delta') {
      out += (chunk as any).text ?? ''
      process.stdout.write((chunk as any).text ?? '')
    }
    if (chunk.type === 'error') {
      throw chunk.error
    }
  }
  return out
}

async function test1_directHappyPath() {
  header('Test 1: customProvider returns isCustomProvider + actually streams')
  const result = await getModelForRequest({
    apiKey: 'cb-not-used-for-this-path',
    model: MODEL,
    customProvider: { baseUrl: BASE_URL, apiKey: 'ollama' },
  })

  console.log(`isCustomProvider: ${result.isCustomProvider} (expect: true)`)
  console.log(`isChatGptOAuth: ${result.isChatGptOAuth} (expect: false)`)
  console.log(`modelId: ${(result.model as any).modelId} (expect: ${MODEL})`)
  if (!result.isCustomProvider) throw new Error('FAIL: isCustomProvider !== true')

  console.log('\nStreaming "Reply in exactly 4 words":')
  const out = await streamAndCollect(
    result.model,
    'Reply in exactly 4 words.',
  )
  console.log('\n')
  if (!out.trim()) throw new Error('FAIL: empty response from Ollama')
  console.log(`✅ Got ${out.length} chars from ${MODEL} via ${BASE_URL}`)
}

async function test2_trailingSlashTolerated() {
  header('Test 2: trailing slash on baseUrl is tolerated')
  const result = await getModelForRequest({
    apiKey: 'cb-not-used',
    model: MODEL,
    customProvider: { baseUrl: 'http://localhost:11434/v1///', apiKey: 'ollama' },
  })
  console.log('Streaming with baseUrl=http://localhost:11434/v1///:')
  const out = await streamAndCollect(result.model, 'Say "ok" only.')
  if (!out.trim()) throw new Error('FAIL: empty response')
  console.log('\n✅ Trailing slashes trimmed correctly')
}

async function test3_unreachableEndpointFriendlyError() {
  header(
    'Test 3: unreachable endpoint produces a friendly error via promptAiSdkStream',
  )
  // We test this via the full promptAiSdkStream path because that's where the
  // error wrapping lives.
  const { promptAiSdkStream } = await import('../sdk/src/impl/llm')

  const messages = [
    {
      role: 'user' as const,
      content: 'Hi',
    },
  ]

  const collected: string[] = []
  let caughtError: Error | null = null
  try {
    const gen = promptAiSdkStream({
      apiKey: 'cb-not-used',
      runId: 'smoke-run-' + Date.now(),
      messages: messages as any,
      clientSessionId: 'smoke',
      fingerprintId: 'smoke',
      model: MODEL as any,
      userId: undefined,
      userInputId: 'smoke-input',
      // Point at a port that is NOT serving anything
      agentProviderOptions: { baseUrl: 'http://127.0.0.1:1/v1' } as any,
      sendAction: () => {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as any,
      trackEvent: () => {},
      signal: new AbortController().signal,
    })
    for await (const chunk of gen) {
      collected.push(JSON.stringify(chunk))
    }
  } catch (e) {
    caughtError = e as Error
  }

  if (!caughtError) {
    throw new Error('FAIL: expected an error, got none. Chunks: ' + collected.join('\n'))
  }
  console.log('Got error message:\n')
  console.log(caughtError.message)
  console.log()
  if (!caughtError.message.includes('Cannot reach LLM provider')) {
    throw new Error(
      'FAIL: error message does not contain "Cannot reach LLM provider"',
    )
  }
  if (!caughtError.message.includes('http://127.0.0.1:1/v1')) {
    throw new Error('FAIL: error message does not contain the configured URL')
  }
  console.log('✅ Friendly error wrapping confirmed (URL + troubleshooting included)')
}

async function test4_envVarFallback() {
  header('Test 4: env-var fallback (CODEBUFF_BASE_URL) is read when agent has no baseUrl')
  process.env.CODEBUFF_BASE_URL = BASE_URL
  process.env.CODEBUFF_PROVIDER_API_KEY = 'ollama'
  try {
    const { promptAiSdkStream } = await import('../sdk/src/impl/llm')

    const collected: string[] = []
    let textChunks = 0
    const gen = promptAiSdkStream({
      apiKey: 'cb-not-used',
      runId: 'smoke-run-env-' + Date.now(),
      messages: [{ role: 'user', content: 'Reply with the word OK only.' }] as any,
      clientSessionId: 'smoke',
      fingerprintId: 'smoke',
      model: MODEL as any,
      userId: undefined,
      userInputId: 'smoke-input',
      // No agentProviderOptions and no clientCustomProvider — only env should apply.
      sendAction: () => {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as any,
      trackEvent: () => {},
      signal: new AbortController().signal,
    })
    for await (const chunk of gen) {
      if (chunk.type === 'text') textChunks++
      collected.push(JSON.stringify(chunk))
    }
    if (textChunks === 0) {
      throw new Error('FAIL: no text chunks via env-var fallback. Got: ' + collected.join('\n'))
    }
    console.log(`✅ Got ${textChunks} text chunk(s) via env-var fallback`)
  } finally {
    delete process.env.CODEBUFF_BASE_URL
    delete process.env.CODEBUFF_PROVIDER_API_KEY
  }
}

async function main() {
  console.log(`Smoke target: ${MODEL} @ ${BASE_URL}`)
  await test1_directHappyPath()
  await test2_trailingSlashTolerated()
  await test3_unreachableEndpointFriendlyError()
  await test4_envVarFallback()
  console.log('\n' + '='.repeat(60))
  console.log('All smoke tests passed ✅')
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('\n❌ Smoke test FAILED:')
  console.error(err.message ?? err)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
