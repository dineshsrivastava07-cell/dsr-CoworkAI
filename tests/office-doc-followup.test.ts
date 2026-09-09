import { describe, expect, it } from 'vitest';
import {
  isLikelyConfirmationFollowUp,
  extractMessageText,
  findRecentSubstantiveUserPrompt,
} from '../src/main/agent/office-doc-followup';
import type { Message } from '../src/renderer/types';

function userMessage(text: string, id = 'm'): Message {
  return {
    id,
    sessionId: 's',
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

function assistantMessage(text: string, id = 'm'): Message {
  return {
    id,
    sessionId: 's',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

describe('isLikelyConfirmationFollowUp', () => {
  it.each([
    'give me excel sheet',
    'give me the sheet',
    'send me the file',
    'go ahead',
    'yes',
    'yes please',
    'ok do it',
    'sure',
    'proceed',
  ])('treats %j as a confirmation follow-up', (text) => {
    expect(isLikelyConfirmationFollowUp(text)).toBe(true);
  });

  it.each([
    'create an excel sheet for school fees collection',
    'hi can you create excel sheet for the school fees collection',
    'make a presentation about our Q3 roadmap with revenue and headcount slides',
    '',
  ])('does not treat %j as a confirmation follow-up', (text) => {
    expect(isLikelyConfirmationFollowUp(text)).toBe(false);
  });

  it('rejects long sentences even if they start with a trigger word', () => {
    // "yes" is a trigger word, but this is clearly a substantive request, not a bare confirmation
    expect(
      isLikelyConfirmationFollowUp(
        'yes and also please add columns for payment method and due date to the tracker'
      )
    ).toBe(false);
  });
});

describe('extractMessageText', () => {
  it('joins text content blocks and trims whitespace', () => {
    const message: Message = {
      id: 'm',
      sessionId: 's',
      role: 'user',
      content: [
        { type: 'text', text: '  hello  ' },
        { type: 'text', text: 'world' },
      ],
      timestamp: Date.now(),
    };
    expect(extractMessageText(message)).toBe('hello  \nworld');
  });

  it('ignores non-text content blocks', () => {
    const message: Message = {
      id: 'm',
      sessionId: 's',
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } } as never,
        { type: 'text', text: 'the real text' },
      ],
      timestamp: Date.now(),
    };
    expect(extractMessageText(message)).toBe('the real text');
  });
});

describe('findRecentSubstantiveUserPrompt', () => {
  it('reproduces the reported bug scenario: pulls the original request, never the assistant echo', () => {
    const history: Message[] = [
      userMessage('hi can a create excel sheet for the school .school fees collection', 'u1'),
      assistantMessage(
        'I will now generate this Excel file for you with some sample data so you can see it in action.',
        'a1'
      ),
    ];
    const currentPrompt = 'give me excel sheet';

    const result = findRecentSubstantiveUserPrompt(history, currentPrompt);

    expect(result).toBe('hi can a create excel sheet for the school .school fees collection');
    expect(result).not.toContain('I will now generate');
  });

  it('skips prior confirmation-style user turns and keeps walking back', () => {
    const history: Message[] = [
      userMessage('create a budget tracker with income and expense columns', 'u1'),
      assistantMessage('Here is the proposed structure...', 'a1'),
      userMessage('yes', 'u2'),
      assistantMessage('Working on it...', 'a2'),
    ];

    const result = findRecentSubstantiveUserPrompt(history, 'go ahead');

    expect(result).toBe('create a budget tracker with income and expense columns');
  });

  it('returns null when no substantive user turn exists', () => {
    const history: Message[] = [userMessage('yes', 'u1'), assistantMessage('Sure!', 'a1')];
    expect(findRecentSubstantiveUserPrompt(history, 'go ahead')).toBeNull();
  });

  it('never returns assistant text even when it is the most recent message', () => {
    const history: Message[] = [
      userMessage('make a school fees tracker', 'u1'),
      assistantMessage('I will now generate this Excel file for you.', 'a1'),
    ];
    const result = findRecentSubstantiveUserPrompt(history, 'give me excel sheet');
    expect(result).not.toContain('I will now generate');
    expect(result).toBe('make a school fees tracker');
  });
});
