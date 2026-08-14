/**
 * Pure helpers for the office-doc interceptor's description sourcing (see
 * tryDirectOfficeToolCall in agent-runner.ts). Deliberately dependency-free — no
 * electron, no MCP, nothing — so they're safely importable and unit-testable without
 * pulling in agent-runner.ts's heavy transitive dependency graph.
 */
import type { Message, ContentBlock } from '../../renderer/types';

/**
 * A short reply like "give me excel sheet" or "yes go ahead" that confirms a prior turn
 * rather than describing new content. When the office-doc interceptor sees one of these,
 * it must not use it verbatim as the artifact description — it carries no content of its
 * own, so it should fall back to the most recent substantive user turn instead (see
 * findRecentSubstantiveUserPrompt).
 */
export function isLikelyConfirmationFollowUp(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.split(/\s+/).length > 8) return false;
  return /\b(give me|send me|go ahead|do it|proceed|yes|yep|yeah|ok|okay|sure|now)\b/i.test(
    trimmed
  );
}

/** Extract plain text from a message's content blocks. */
export function extractMessageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Walk backward through session history for the most recent USER turn that actually
 * describes something (skipping the current prompt and any other confirmation-style
 * replies). Never returns assistant text — assistant turns are excluded by construction,
 * which is what prevents the interceptor from ever echoing the model's own prior reply
 * back as a document description/filename.
 */
export function findRecentSubstantiveUserPrompt(
  existingMessages: Message[],
  currentPrompt: string
): string | null {
  for (let i = existingMessages.length - 1; i >= 0; i--) {
    const message = existingMessages[i];
    if (message.role !== 'user') continue;
    const text = extractMessageText(message);
    if (!text || text === currentPrompt) continue;
    if (isLikelyConfirmationFollowUp(text)) continue;
    return text;
  }
  return null;
}
