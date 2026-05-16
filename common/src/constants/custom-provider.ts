/** Env var that overrides the upstream LLM endpoint with an OpenAI-compatible base URL.
 *  Lower precedence than per-agent providerOptions.baseUrl and the CodebuffClient option. */
export const PROVIDER_BASE_URL_ENV_VAR = 'CODEBUFF_BASE_URL'

/** Env var providing the API key for the endpoint set by PROVIDER_BASE_URL_ENV_VAR.
 *  Most local runtimes (Ollama, LM Studio) ignore the key entirely. */
export const PROVIDER_API_KEY_ENV_VAR = 'CODEBUFF_PROVIDER_API_KEY'
