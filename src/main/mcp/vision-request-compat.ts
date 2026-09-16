export function buildOpenAIVisionTokenLimit(
  maxTokens: number,
  compatibilityMode: boolean,
  previousErrorMessage?: string
): Record<string, number> {
  if (
    compatibilityMode &&
    previousErrorMessage &&
    /unsupported parameter:\s*['"]?max_tokens['"]?/i.test(previousErrorMessage)
  ) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}
