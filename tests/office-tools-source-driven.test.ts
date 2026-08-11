import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const officeToolsPath = path.resolve(process.cwd(), 'src/main/mcp/office-tools-server.ts');
const officeToolsContent = readFileSync(officeToolsPath, 'utf8');

describe('Office Tools source-driven artifact generation', () => {
  it('does not use invented WBS phase templates for source workbook WBS output', () => {
    expect(officeToolsContent).toContain('generateExcelWbsFromWorkbookSource');
    expect(officeToolsContent).toContain('Planned Source Rows');
    expect(officeToolsContent).toContain('Source Reference');
    expect(officeToolsContent).not.toContain('Mobilise and confirm scope');
    expect(officeToolsContent).not.toContain('SIT, UAT, security review and deployment');
    expect(officeToolsContent).not.toContain('Product Owner / Data Team');
  });

  it('does not add fixed business next actions to source-driven presentations', () => {
    expect(officeToolsContent).toContain('Data Readiness Summary');
    expect(officeToolsContent).toContain('genericWorkbookPresentation');
    expect(officeToolsContent).toContain('Presentation generated from attached workbook sheets');
    expect(officeToolsContent).not.toContain('Immediate Next Actions');
    expect(officeToolsContent).not.toContain('Close platform fee');
    expect(officeToolsContent).not.toContain('Confirm wave sequencing');
    expect(officeToolsContent).not.toContain('Quarterly Business Review');
  });
});
