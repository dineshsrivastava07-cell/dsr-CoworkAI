import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// gui-operate-server.ts calls main().catch(...) unconditionally at module load
// (it's a standalone MCP stdio server entry point), so it cannot be imported
// directly in a unit test without spinning up a real server process. Following
// the same convention as tests/office-tools-source-driven.test.ts, these tests
// assert on the source text itself.
const guiOperatePath = path.resolve(process.cwd(), 'src/main/mcp/gui-operate-server.ts');
const guiOperateContent = readFileSync(guiOperatePath, 'utf8');

describe('GUI operate safety hardening', () => {
  describe('irreversible-action gating', () => {
    it('defines a keyword classifier for irreversible click intent', () => {
      expect(guiOperateContent).toContain('function isLikelyIrreversible');
      expect(guiOperateContent).toMatch(/send\|submit\|delete\|remove\|purchase\|buy\|pay/);
    });

    it('the click handler refuses irreversible intent unless confirm_irreversible is set', () => {
      const clickCaseStart = guiOperateContent.indexOf("case 'click': {");
      expect(clickCaseStart).toBeGreaterThan(-1);
      const clickCaseSlice = guiOperateContent.slice(clickCaseStart, clickCaseStart + 2000);
      expect(clickCaseSlice).toContain('isLikelyIrreversible(intent)');
      expect(clickCaseSlice).toContain('confirm_irreversible');
      expect(clickCaseSlice).toContain('Refusing click');
    });

    it('exposes intent/confirm_irreversible on the click tool schema', () => {
      const schemaStart = guiOperateContent.indexOf("name: 'click',");
      const schemaSlice = guiOperateContent.slice(schemaStart, schemaStart + 2500);
      expect(schemaSlice).toContain('intent:');
      expect(schemaSlice).toContain('confirm_irreversible:');
    });
  });

  describe('app denylist', () => {
    it('defines a default denylist including common password managers', () => {
      expect(guiOperateContent).toContain('DEFAULT_GUI_DENYLIST_APPS');
      expect(guiOperateContent).toContain('1password');
      expect(guiOperateContent).toContain('keychain access');
      expect(guiOperateContent).toContain('bitwarden');
    });

    it('is extensible via GUI_DENYLIST_APPS env var', () => {
      expect(guiOperateContent).toContain('GUI_DENYLIST_APPS');
    });

    it('click, type_text, and drag all check the foreground app denylist before acting', () => {
      const occurrences = guiOperateContent.match(/checkForegroundAppDenylist\(\)/g) ?? [];
      // 1 definition-site reference (inside the function body doesn't call itself) +
      // 3 call sites (click, type_text, drag)
      expect(occurrences.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('post-action verification', () => {
    it('defines a before/after screen-state hash comparison helper', () => {
      expect(guiOperateContent).toContain('function hashDisplaySnapshot');
      expect(guiOperateContent).toContain('function withActionVerification');
      expect(guiOperateContent).toContain("createHash('sha256')");
    });

    it('click, drag, and key_press results are wrapped with verification', () => {
      const occurrences = guiOperateContent.match(/withActionVerification\(/g) ?? [];
      // 1 definition-site self-reference in the doc comment area is not a call,
      // so this should be exactly the 3 call sites (click, drag, key_press).
      expect(occurrences.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('emergency stop (kill-switch)', () => {
    it('defines an emergency-stop flag checked before dispatching actions', () => {
      expect(guiOperateContent).toContain('let emergencyStopActive');
      const guardOccurrences = guiOperateContent.match(/if \(emergencyStopActive\)/g) ?? [];
      expect(guardOccurrences.length).toBeGreaterThanOrEqual(4); // click, type_text, key_press, drag
    });

    it('exposes emergency_stop and resume_automation tools', () => {
      expect(guiOperateContent).toContain("name: 'emergency_stop'");
      expect(guiOperateContent).toContain("name: 'resume_automation'");
      expect(guiOperateContent).toContain("case 'emergency_stop':");
      expect(guiOperateContent).toContain("case 'resume_automation':");
    });
  });
});
