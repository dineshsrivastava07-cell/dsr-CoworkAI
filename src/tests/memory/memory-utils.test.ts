import { describe, expect, it } from 'vitest';
import { looksLikeDegenerateAutomationSession } from '../../main/memory/memory-utils';
import type { Message } from '../../renderer/types';

function toolResultMessage(content: string, isError = false): Message {
  return {
    id: 'm',
    sessionId: 's',
    role: 'assistant',
    content: [{ type: 'tool_result', toolUseId: 'call_1', content, isError }],
    timestamp: Date.now(),
  };
}

function userMessage(text: string): Message {
  return {
    id: 'u',
    sessionId: 's',
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

describe('looksLikeDegenerateAutomationSession', () => {
  it('reproduces the reported bug scenario: repeated browser-navigation failures', () => {
    const messages: Message[] = [
      userMessage(
        'connect browser and open amazon.in and find out smart mobile phone under 15000/-'
      ),
      toolResultMessage('No page selected'),
      toolResultMessage('## Pages\n1: Google (https://www.google.com/) [selected]'),
      toolResultMessage('Error: Navigation timeout of 10000 ms exceeded'),
      toolResultMessage('The selected page has been closed. Call list_pages to see open pages.'),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(true);
  });

  it('does not flag a session with mostly successful tool results', () => {
    const messages: Message[] = [
      userMessage('find smart mobile phones under 15000 on amazon.in'),
      toolResultMessage('## Pages\n1: Amazon.in (https://www.amazon.in/) [selected]'),
      toolResultMessage('Successfully navigated to https://www.amazon.in'),
      toolResultMessage(
        'Search results: Redmi 13C (₹9,999), Samsung Galaxy M14 (₹11,499), Realme Narzo 60 (₹13,999)'
      ),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(false);
  });

  it('does not flag short sessions below the minimum tool-result count', () => {
    // Only 2 tool_results, both failures — below the total>=3 floor, so it's not
    // confidently "mostly failures", just possibly a single retry.
    const messages: Message[] = [
      userMessage('open amazon.in'),
      toolResultMessage('No page selected'),
      toolResultMessage('Error: Navigation timeout of 10000 ms exceeded'),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(false);
  });

  it('does not flag a session with no tool_result blocks at all', () => {
    const messages: Message[] = [
      userMessage('what is the capital of France?'),
      {
        id: 'a',
        sessionId: 's',
        role: 'assistant',
        content: [{ type: 'text', text: 'Paris.' }],
        timestamp: Date.now(),
      },
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(false);
  });

  it('requires a majority of failures, not just a few among many successes', () => {
    const messages: Message[] = [
      userMessage('research task'),
      toolResultMessage('page loaded successfully'),
      toolResultMessage('page loaded successfully'),
      toolResultMessage('page loaded successfully'),
      toolResultMessage('extracted 12 rows of data'),
      toolResultMessage('Error: Navigation timeout of 10000 ms exceeded'),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(false);
  });

  it('reproduces the second reported bug scenario: repeated permission denials', () => {
    // A distinct failure mode from the first regression test above — the
    // browser calls themselves succeed at the transport level, but the user
    // denies permission for each one. This slipped through the original
    // filter (which only matched browser error text like "no page selected")
    // and got memorized, then re-injected into a later session, priming the
    // model to repeat the same derailment.
    const messages: Message[] = [
      userMessage(
        'connect browser and open amazon.in and search for phones and computer accessories'
      ),
      toolResultMessage('Successfully navigated to https://www.amazon.in.'),
      toolResultMessage("User denied permission for 'navigate_page'."),
      toolResultMessage("User denied permission for 'new_page'."),
      toolResultMessage("User denied permission for 'new_page'."),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(true);
  });

  it('reproduces the third reported bug scenario: expired Google Workspace connection', () => {
    // A daily scheduled "morning brief" task kept hitting an expired Google
    // OAuth connection (7-day refresh-token expiry in Testing publishing
    // status) and the model spiraled into fabricating workaround scripts
    // instead of reporting the failure. Without this pattern, that failed
    // session would get memorized and re-injected into future runs, priming
    // the same derailment on every subsequent day.
    const messages: Message[] = [
      userMessage('Create Morning brief every day From Gmail, Google Drive and Calendar'),
      toolResultMessage(
        'Google connection for dineshsrivastava07@gmail.com needs to be re-authorized.'
      ),
      toolResultMessage(
        '❌ Error in gmail_list_messages: Google connection for dineshsrivastava07@gmail.com needs to be re-authorized.'
      ),
      toolResultMessage(
        'Google account is not connected. Open Settings → Connectors → Google Workspace and click "Connect".'
      ),
    ];
    expect(looksLikeDegenerateAutomationSession(messages)).toBe(true);
  });
});
