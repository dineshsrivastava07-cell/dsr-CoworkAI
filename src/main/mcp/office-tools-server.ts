/**
 * Office Tools MCP Server for V-Coworker
 *
 * Creates Excel (.xlsx), Word (.docx), and PowerPoint (.pptx) files
 * based on structured content provided by the agent.
 *
 * Tools:
 *   create_excel        — spreadsheet with multiple sheets, headers, data, totals
 *   create_word_document — Word doc with headings, paragraphs, lists, tables
 *   create_presentation  — PowerPoint with title/content/table/two-column slides
 */

import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  callOllamaChat,
  extractJsonObject,
  pickModelForTask,
  validateGeneratedContent,
} from '../config/ollama-content';
import { parseIsoDate, isoDate, computeGanttBarColumns } from './office-tools-gantt';

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultOutputDir(): string {
  return process.env.WORKSPACE_DIR || path.join(os.homedir(), 'Desktop');
}

function ensureExt(filename: string, ext: string): string {
  return filename.endsWith(ext) ? filename : `${filename}${ext}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ─── Excel ──────────────────────────────────────────────────────────────────

interface ExcelChartDef {
  /** 0-based index of the numeric column to visualize as an in-cell data bar. */
  value_column: number;
}

interface ExcelFormulaCell {
  /** Excel formula without the leading '=', e.g. "NPV(0.1,B2:B10)+B1", "STDEV(B2:B10)", "SUM(B2:B10)". */
  formula: string;
  /** Optional display format, e.g. '$#,##0.00', '0.00%', '#,##0'. */
  numFmt?: string;
}

type ExcelCellValue = string | number | boolean | null | ExcelFormulaCell;

function isExcelFormulaCell(value: unknown): value is ExcelFormulaCell {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExcelFormulaCell).formula === 'string'
  );
}

interface ExcelGanttBar {
  /** 1-based data row number within this sheet (header row is row 1, first data row is row 2). */
  row: number;
  /** 1-based first column to fill (inclusive). */
  startCol: number;
  /** 1-based last column to fill (inclusive). */
  endCol: number;
  /** Optional ARGB fill color, e.g. 'FF4A7DCF'. Defaults to a standard blue. */
  argb?: string;
}

interface ExcelSheetDef {
  name: string;
  headers: string[];
  rows: ExcelCellValue[][];
  column_widths?: number[];
  freeze_header?: boolean;
  add_totals_row?: boolean;
  /** Optional analytics visual: renders a native Excel data-bar over a numeric column. */
  chart?: ExcelChartDef;
  /** Optional Gantt-style visual: solid-fills a date-range of cells per task row. */
  ganttBars?: ExcelGanttBar[];
}

interface CreateExcelParams {
  filename: string;
  output_dir?: string;
  sheets: ExcelSheetDef[];
}

async function createExcel(params: CreateExcelParams): Promise<string> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.default.Workbook();
  wb.creator = 'V-Coworker';
  wb.created = new Date();

  const outDir = params.output_dir || defaultOutputDir();
  await ensureDir(outDir);
  const outPath = path.join(outDir, ensureExt(params.filename, '.xlsx'));

  for (const sheetDef of params.sheets) {
    const ws = wb.addWorksheet(sheetDef.name || 'Sheet1');

    // Header row with styling
    if (sheetDef.headers && sheetDef.headers.length > 0) {
      const headerRow = ws.addRow(sheetDef.headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F4E79' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF9DC3E6' } },
        };
      });
      headerRow.height = 22;
      if (sheetDef.freeze_header !== false) {
        ws.views = [{ state: 'frozen', ySplit: 1 }];
      }
    }

    // Data rows
    for (const row of sheetDef.rows || []) {
      const rowValues = row.map((cell) =>
        isExcelFormulaCell(cell) ? { formula: cell.formula } : cell
      );
      const dataRow = ws.addRow(rowValues);
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        // Zebra striping — skipped on Gantt sheets: a timeline needs a blank
        // background so the ganttBars fill (applied below, after all rows are
        // added) is the only visual signal, not washed out by shading every
        // other row across the full day-column width.
        const rowIdx = dataRow.number;
        if (rowIdx % 2 === 0 && !sheetDef.ganttBars) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCE6F1' },
          };
        }
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFB8CCE4' } },
        };
        const orig = row[colNum - 1];
        if (isExcelFormulaCell(orig)) {
          // Formula results are typically numeric — right-align and apply the
          // caller's format (e.g. '$#,##0.00', '0.00%') or a sensible default.
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = orig.numFmt || '#,##0.00';
        } else if (typeof orig === 'number') {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = Number.isInteger(orig) ? '#,##0' : '#,##0.00';
        }
      });
    }

    // Totals row for numeric columns
    if (sheetDef.add_totals_row && sheetDef.rows && sheetDef.rows.length > 0) {
      const numCols = sheetDef.headers.length;
      const dataStart = 2; // row 1 = header
      const dataEnd = sheetDef.rows.length + 1;
      const totalsRow: (string | { formula: string })[] = [];

      for (let c = 0; c < numCols; c++) {
        const hasNumbers = sheetDef.rows.some((r) => typeof r[c] === 'number');
        if (hasNumbers) {
          const colLetter = ws.getColumn(c + 1).letter;
          totalsRow.push({ formula: `SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})` });
        } else if (c === 0) {
          totalsRow.push('TOTAL');
        } else {
          totalsRow.push('');
        }
      }

      const totalRow = ws.addRow(totalsRow);
      totalRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFD966' },
        };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF1F4E79' } },
        };
      });
    }

    // Column widths
    if (sheetDef.column_widths) {
      sheetDef.column_widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
    } else {
      // Auto-size based on header length
      sheetDef.headers.forEach((h, i) => {
        const maxLen = Math.max(
          h.length,
          ...(sheetDef.rows || []).map((r) => {
            const cell = r[i];
            return isExcelFormulaCell(cell) ? 12 : String(cell ?? '').length;
          })
        );
        ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 12), 40);
      });
    }

    // Analytics visual: native Excel data-bar over a numeric column (ExcelJS has no
    // chart-object API, so a data-bar conditional format is the supported way to add
    // an at-a-glance visual without embedding a fragile image).
    if (
      sheetDef.chart &&
      sheetDef.rows &&
      sheetDef.rows.length > 0 &&
      sheetDef.chart.value_column >= 0 &&
      sheetDef.chart.value_column < sheetDef.headers.length
    ) {
      const colLetter = ws.getColumn(sheetDef.chart.value_column + 1).letter;
      const dataStart = 2;
      const dataEnd = sheetDef.rows.length + 1;
      ws.addConditionalFormatting({
        ref: `${colLetter}${dataStart}:${colLetter}${dataEnd}`,
        rules: [
          {
            type: 'dataBar',
            priority: 1,
            cfvo: [{ type: 'min' }, { type: 'max' }],
            gradient: true,
          },
        ],
      });
    }

    // Gantt visual: solid-fill the date-span cells for each task row. Reuses the
    // same direct cell.fill technique already used above for header/zebra styling
    // — a Gantt timeline is a per-row date-range highlight, not a single numeric
    // value, so a data-bar/conditional-format rule doesn't fit; a direct fill does.
    for (const bar of sheetDef.ganttBars || []) {
      const row = ws.getRow(bar.row);
      for (let col = bar.startCol; col <= bar.endCol; col++) {
        row.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bar.argb || 'FF4A7DCF' },
        };
      }
      row.commit();
    }
  }

  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── Description-based Template Generators ───────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

/**
 * Defense-in-depth: a small/local model asked to fill a tool's `description` argument can
 * end up echoing its OWN prior conversational sentence ("I will now generate this Excel
 * file...") instead of describing the artifact. Using that verbatim as a filename basis
 * produces nonsense like "i_will_now_generate_this_excel.xlsx". This is a last-resort guard
 * at the tool boundary — the primary fix lives upstream in agent-runner.ts's interceptor,
 * which never looks at assistant text in the first place; this catches whatever reaches here
 * regardless of which path it came from.
 */
export function looksLikeAssistantEcho(desc: string): boolean {
  return /^(i will|i'll|i am going to|let me|sure[,.]|okay[,.]|now i|here is|here's)\b/i.test(
    desc.trim()
  );
}

function detectDocType(desc: string): string {
  const d = desc.toLowerCase();
  if (/invoice|bill|billing/.test(d)) return 'invoice';
  if (/sales|revenue|commission/.test(d)) return 'sales';
  if (/budget|expense|cost/.test(d)) return 'budget';
  if (/inventor|stock|warehouse/.test(d)) return 'inventory';
  if (/schedule|timeline|calendar/.test(d)) return 'schedule';
  if (/tracker|tracking|task|project/.test(d)) return 'tracker';
  if (/payroll|salary|hr|employee/.test(d)) return 'hr';
  return 'report';
}

function generateExcelFromDescription(description: string, filename?: string): CreateExcelParams {
  const type = detectDocType(description);
  const d = description.toLowerCase();
  const isStationery =
    /stationer|office suppl|pen|pencil|paper|notebook|folder|binder|marker|eraser/.test(d);
  const fname = filename || slugify(description) || 'document';

  if (type === 'invoice') {
    const items: (string | number)[][] = isStationery
      ? [
          [1, 'Blue Ball-Point Pens (Box of 12)', 'Writing', 5, 12.5, 62.5],
          [2, 'A4 Copy Paper 80gsm (Ream 500 sheets)', 'Paper', 10, 8.0, 80.0],
          [3, 'Hardcover Spiral Notebook A5', 'Notebooks', 8, 6.5, 52.0],
          [4, 'Permanent Markers — Assorted 4 Colours', 'Markers', 6, 9.0, 54.0],
          [5, 'Clear Document Folders (Pack of 10)', 'Filing', 4, 11.0, 44.0],
          [6, 'Correction Fluid / White-Out (3-pack)', 'Correction', 3, 7.5, 22.5],
          [7, 'Sticky Notes 3×3 in (6-pack)', 'Adhesives', 12, 5.0, 60.0],
          [8, 'Highlighters — Assorted 5 Colours', 'Highlighting', 6, 8.0, 48.0],
          [9, 'Desktop Stapler + Staples Refill', 'Desk Accessories', 2, 15.0, 30.0],
          [10, 'Binder Clips Assorted (Box)', 'Binding', 5, 4.5, 22.5],
        ]
      : [
          [1, 'Product / Service 1', 'General', 1, 100.0, 100.0],
          [2, 'Product / Service 2', 'General', 2, 75.0, 150.0],
          [3, 'Product / Service 3', 'General', 3, 50.0, 150.0],
        ];
    const subtotal = items.reduce((s, r) => s + (r[5] as number), 0);
    const discount = +(subtotal * 0.05).toFixed(2);
    const taxable = subtotal - discount;
    const tax = +(taxable * 0.1).toFixed(2);
    const shipping = 15.0;
    const grand = +(taxable + tax + shipping).toFixed(2);
    return {
      filename: fname,
      sheets: [
        {
          name: 'Invoice',
          headers: ['#', 'Item Description', 'Category', 'Qty', 'Unit Price ($)', 'Amount ($)'],
          rows: items,
          freeze_header: true,
        },
        {
          name: 'Summary',
          headers: ['Description', 'Amount ($)'],
          rows: [
            ['Subtotal', subtotal],
            ['Discount (5%)', -discount],
            ['Taxable Amount', taxable],
            ['Tax / GST (10%)', tax],
            ['Shipping & Handling', shipping],
            ['GRAND TOTAL', grand],
          ],
        },
      ],
    };
  }

  if (type === 'sales') {
    return {
      filename: fname,
      sheets: [
        {
          name: 'Sales Report',
          headers: [
            'Month',
            'Product',
            'Units Sold',
            'Unit Price ($)',
            'Revenue ($)',
            'Target ($)',
            'Achievement (%)',
          ],
          rows: [
            ['Jan 2025', 'Product A', 120, 45, 5400, 5000, '108%'],
            ['Feb 2025', 'Product A', 95, 45, 4275, 5000, '86%'],
            ['Mar 2025', 'Product A', 150, 45, 6750, 5000, '135%'],
            ['Jan 2025', 'Product B', 80, 75, 6000, 6000, '100%'],
            ['Feb 2025', 'Product B', 110, 75, 8250, 6000, '138%'],
            ['Mar 2025', 'Product B', 90, 75, 6750, 6000, '113%'],
          ],
          add_totals_row: true,
        },
      ],
    };
  }

  if (type === 'budget') {
    return {
      filename: fname,
      sheets: [
        {
          name: 'Budget',
          headers: ['Category', 'Item', 'Budgeted ($)', 'Actual ($)', 'Variance ($)', 'Status'],
          rows: [
            ['Operations', 'Office Rent', 3000, 3000, 0, 'On Budget'],
            ['Operations', 'Utilities', 500, 475, 25, 'Under Budget'],
            ['Operations', 'Internet & Phone', 200, 210, -10, 'Over Budget'],
            ['Personnel', 'Salaries', 15000, 15000, 0, 'On Budget'],
            ['Personnel', 'Benefits', 2500, 2350, 150, 'Under Budget'],
            ['Marketing', 'Digital Ads', 2000, 1850, 150, 'Under Budget'],
            ['Equipment', 'Hardware', 1000, 950, 50, 'Under Budget'],
            ['Equipment', 'Software Licenses', 800, 800, 0, 'On Budget'],
          ],
          add_totals_row: true,
        },
      ],
    };
  }

  if (type === 'inventory') {
    return {
      filename: fname,
      sheets: [
        {
          name: 'Inventory',
          headers: [
            'SKU',
            'Item Name',
            'Category',
            'Qty in Stock',
            'Reorder Level',
            'Unit Cost ($)',
            'Total Value ($)',
            'Status',
          ],
          rows: isStationery
            ? [
                ['SKU001', 'Blue Pens (Box/12)', 'Writing', 45, 10, 8.5, 382.5, 'In Stock'],
                ['SKU002', 'A4 Paper (Ream)', 'Paper', 8, 20, 6.0, 48.0, 'Low Stock'],
                ['SKU003', 'Notebooks A5', 'Stationery', 30, 10, 5.0, 150.0, 'In Stock'],
                ['SKU004', 'Staplers', 'Desk', 12, 5, 12.0, 144.0, 'In Stock'],
                ['SKU005', 'Correction Fluid', 'Correction', 3, 10, 4.5, 13.5, 'Low Stock'],
              ]
            : [
                ['SKU001', 'Item A', 'Category 1', 50, 10, 25.0, 1250.0, 'In Stock'],
                ['SKU002', 'Item B', 'Category 2', 5, 15, 40.0, 200.0, 'Low Stock'],
                ['SKU003', 'Item C', 'Category 1', 100, 20, 15.0, 1500.0, 'In Stock'],
              ],
          add_totals_row: true,
        },
      ],
    };
  }

  if (type === 'tracker') {
    return {
      filename: fname,
      sheets: [
        {
          name: 'Task Tracker',
          headers: [
            'Task ID',
            'Task Name',
            'Assigned To',
            'Priority',
            'Status',
            'Start Date',
            'Due Date',
            'Progress (%)',
          ],
          rows: [
            [
              'T001',
              'Research & Planning',
              'Team Lead',
              'High',
              'Completed',
              '01/07/2025',
              '07/07/2025',
              100,
            ],
            [
              'T002',
              'Design & Mockups',
              'Designer',
              'High',
              'In Progress',
              '08/07/2025',
              '15/07/2025',
              65,
            ],
            [
              'T003',
              'Development Sprint 1',
              'Dev Team',
              'High',
              'In Progress',
              '10/07/2025',
              '20/07/2025',
              40,
            ],
            [
              'T004',
              'Content Writing',
              'Content Team',
              'Medium',
              'Not Started',
              '15/07/2025',
              '25/07/2025',
              0,
            ],
            ['T005', 'QA Testing', 'QA Team', 'High', 'Not Started', '21/07/2025', '28/07/2025', 0],
            [
              'T006',
              'Launch & Deployment',
              'DevOps',
              'Critical',
              'Not Started',
              '29/07/2025',
              '31/07/2025',
              0,
            ],
          ],
        },
      ],
    };
  }

  // Default: report
  return {
    filename: fname,
    sheets: [
      {
        name: 'Report',
        headers: ['#', 'Category', 'Description', 'Value', 'Date', 'Status', 'Notes'],
        rows: [
          [1, 'Section A', 'Item description 1', 1500, '01/07/2025', 'Completed', ''],
          [2, 'Section A', 'Item description 2', 2200, '05/07/2025', 'In Progress', ''],
          [3, 'Section B', 'Item description 3', 800, '10/07/2025', 'Pending', ''],
          [4, 'Section B', 'Item description 4', 3100, '12/07/2025', 'Completed', ''],
          [5, 'Section C', 'Item description 5', 950, '15/07/2025', 'In Progress', ''],
        ],
        add_totals_row: true,
      },
    ],
  };
}

function generateWordFromDescription(description: string, filename?: string): CreateWordParams {
  const d = description.toLowerCase();
  const fname = filename || slugify(description) || 'document';

  if (/proposal/.test(d)) {
    return {
      filename: fname,
      title: 'Project Proposal',
      blocks: [
        {
          type: 'paragraph',
          heading: 'Executive Summary',
          heading_level: 1,
          text: 'This proposal outlines the objectives, scope, timeline, and budget for the proposed project. It has been prepared in response to the stated requirements and represents our best approach to delivering a successful outcome.',
        },
        {
          type: 'paragraph',
          heading: 'Project Objectives',
          heading_level: 1,
          text: 'The primary objectives of this project are:',
        },
        {
          type: 'bullet_list',
          items: [
            'Deliver a high-quality solution on time and within budget',
            'Meet all stated functional and non-functional requirements',
            'Ensure stakeholder satisfaction throughout the project lifecycle',
            'Provide comprehensive documentation and handover support',
          ],
        },
        {
          type: 'paragraph',
          heading: 'Scope of Work',
          heading_level: 1,
          text: 'The scope of this engagement includes the following activities and deliverables:',
        },
        {
          type: 'numbered_list',
          items: [
            'Phase 1: Discovery & Requirements Analysis (2 weeks)',
            'Phase 2: Design & Planning (2 weeks)',
            'Phase 3: Development & Implementation (6 weeks)',
            'Phase 4: Testing & Quality Assurance (2 weeks)',
            'Phase 5: Deployment & Handover (1 week)',
          ],
        },
        {
          type: 'table',
          heading: 'Budget Summary',
          heading_level: 1,
          table: {
            headers: ['Phase', 'Duration', 'Cost ($)'],
            rows: [
              ['Discovery', '2 weeks', '5,000'],
              ['Design', '2 weeks', '8,000'],
              ['Development', '6 weeks', '30,000'],
              ['Testing', '2 weeks', '6,000'],
              ['Deployment', '1 week', '3,000'],
              ['TOTAL', '13 weeks', '52,000'],
            ],
          },
        },
        {
          type: 'paragraph',
          heading: 'Next Steps',
          heading_level: 1,
          text: 'Upon acceptance of this proposal, we will schedule a project kick-off meeting to align on expectations, establish communication protocols, and confirm the project schedule.',
        },
      ],
    };
  }

  if (/report/.test(d)) {
    return {
      filename: fname,
      title: 'Business Report',
      blocks: [
        {
          type: 'paragraph',
          heading: 'Executive Summary',
          heading_level: 1,
          text: 'This report provides a comprehensive overview of activities, results, and findings for the reporting period. Key highlights include performance against targets, notable achievements, and areas requiring attention.',
        },
        { type: 'paragraph', heading: 'Key Findings', heading_level: 1, text: '' },
        {
          type: 'bullet_list',
          items: [
            'Overall performance exceeded targets by 12% for the quarter',
            'Customer satisfaction scores improved from 78% to 86%',
            'Three new initiatives were launched on schedule',
            'Cost reduction measures delivered $45,000 in savings',
          ],
        },
        {
          type: 'table',
          heading: 'Performance Summary',
          heading_level: 2,
          table: {
            headers: ['Metric', 'Target', 'Actual', 'Variance'],
            rows: [
              ['Revenue', '$500,000', '$562,000', '+12.4%'],
              ['Costs', '$300,000', '$285,000', '-5.0%'],
              ['Profit', '$200,000', '$277,000', '+38.5%'],
              ['Customer Satisfaction', '80%', '86%', '+6%'],
            ],
          },
        },
        { type: 'paragraph', heading: 'Recommendations', heading_level: 1, text: '' },
        {
          type: 'numbered_list',
          items: [
            'Continue investment in customer experience improvements',
            'Expand the digital marketing budget by 20%',
            'Initiate Phase 2 of the technology upgrade programme',
            'Review supplier contracts for further cost optimisation',
          ],
        },
        {
          type: 'paragraph',
          heading: 'Conclusion',
          heading_level: 1,
          text: 'The results for this period demonstrate strong execution and a positive trajectory. The team is well-positioned to build on these results in the coming quarter.',
        },
      ],
    };
  }

  if (/letter/.test(d)) {
    return {
      filename: fname,
      title: 'Business Letter',
      blocks: [
        {
          type: 'paragraph',
          text: `Date: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`,
        },
        {
          type: 'paragraph',
          text: 'To:\n[Recipient Name]\n[Recipient Title]\n[Company Name]\n[Address]',
        },
        {
          type: 'paragraph',
          heading: 'Subject',
          heading_level: 2,
          text: '[Subject of the Letter]',
        },
        { type: 'paragraph', text: 'Dear [Recipient Name],' },
        {
          type: 'paragraph',
          text: 'I am writing to you regarding [main topic or purpose of the letter]. This communication aims to [state the objective clearly and concisely].',
        },
        {
          type: 'paragraph',
          text: '[Add supporting details, background information, or specific points here. Be clear and professional.]',
        },
        {
          type: 'paragraph',
          text: 'We would appreciate your response at your earliest convenience. Please do not hesitate to contact us should you require any additional information or clarification.',
        },
        {
          type: 'paragraph',
          text: 'Yours sincerely,\n\n\n[Your Name]\n[Your Title]\n[Your Organisation]\n[Contact Details]',
        },
      ],
    };
  }

  if (/agenda/.test(d)) {
    return {
      filename: fname,
      title: 'Meeting Agenda',
      blocks: [
        {
          type: 'table',
          table: {
            headers: ['Field', 'Details'],
            rows: [
              ['Meeting Title', '[Meeting Name]'],
              ['Date', new Date().toLocaleDateString()],
              ['Time', '10:00 AM – 11:00 AM'],
              ['Location / Platform', 'Conference Room / Zoom'],
              ['Facilitator', '[Name]'],
              ['Note-Taker', '[Name]'],
            ],
          },
        },
        { type: 'paragraph', heading: 'Attendees', heading_level: 1, text: '' },
        { type: 'bullet_list', items: ['[Name] — [Role]', '[Name] — [Role]', '[Name] — [Role]'] },
        {
          type: 'table',
          heading: 'Agenda Items',
          heading_level: 1,
          table: {
            headers: ['#', 'Agenda Item', 'Presenter', 'Duration'],
            rows: [
              ['1', 'Welcome & Introductions', 'Facilitator', '5 min'],
              ['2', 'Review of Previous Action Items', 'All', '10 min'],
              ['3', 'Main Agenda Item 1', '[Name]', '15 min'],
              ['4', 'Main Agenda Item 2', '[Name]', '15 min'],
              ['5', 'Discussion & Q&A', 'All', '10 min'],
              ['6', 'Action Items & Next Steps', 'Facilitator', '5 min'],
            ],
          },
        },
      ],
    };
  }

  // Default general document
  return {
    filename: fname,
    title: description,
    blocks: [
      {
        type: 'paragraph',
        heading: 'Introduction',
        heading_level: 1,
        text: 'This document provides information related to the subject matter. Please update this content with your specific details and requirements.',
      },
      { type: 'paragraph', heading: 'Key Points', heading_level: 1, text: '' },
      {
        type: 'bullet_list',
        items: [
          'Key point 1 — replace with your content',
          'Key point 2 — replace with your content',
          'Key point 3 — replace with your content',
        ],
      },
      {
        type: 'paragraph',
        heading: 'Details',
        heading_level: 1,
        text: 'Provide additional details and supporting information here. This section can contain multiple paragraphs, tables, and lists as needed.',
      },
      {
        type: 'paragraph',
        heading: 'Conclusion',
        heading_level: 1,
        text: 'Summarise the key takeaways and any next steps or actions required.',
      },
    ],
  };
}

function generatePresentationFromDescription(
  description: string,
  filename?: string
): CreatePresentationParams {
  const fname = filename || slugify(description) || 'presentation';
  const title = description.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
  const terms = uniqueNonEmpty(
    description
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 3)
  ).slice(0, 8);

  return {
    filename: fname,
    title,
    subtitle: 'Draft generated from the user request',
    slides: [
      {
        layout: 'content',
        title: 'Request Summary',
        bullets: [
          `User request: ${truncateText(description, 180)}`,
          'No source-backed facts were available to the fallback generator.',
          'Content below is a neutral outline and should be expanded with provided source material.',
        ],
      },
      {
        layout: 'content',
        title: 'Detected Topics',
        bullets: terms.length > 0 ? terms : ['No specific source topics detected in the request.'],
      },
      {
        layout: 'content',
        title: 'Suggested Structure',
        bullets: [
          'Context and objective',
          'Source-backed findings or sections',
          'Risks, gaps, or decisions',
          'Recommended next actions',
        ],
      },
    ],
  };
}

// ─── Word Document ───────────────────────────────────────────────────────────

interface WordTableDef {
  headers: string[];
  rows: string[][];
}

interface WordBlock {
  type?: 'paragraph' | 'bullet_list' | 'numbered_list' | 'table' | 'page_break';
  heading?: string;
  heading_level?: 1 | 2 | 3;
  text?: string;
  items?: (string | { text?: string })[];
  table?: WordTableDef;
}

function normalizeWordBlockItems(items: WordBlock['items']): string[] {
  return (items || []).map((item) => (typeof item === 'string' ? item : (item?.text ?? '')));
}

function inferWordBlockType(block: WordBlock): NonNullable<WordBlock['type']> {
  if (block.type) return block.type;
  if (block.table) return 'table';
  if (block.items && block.items.length) return 'bullet_list';
  return 'paragraph';
}

interface CreateWordParams {
  filename: string;
  output_dir?: string;
  title?: string;
  author?: string;
  blocks: WordBlock[];
}

async function createWordDocument(params: CreateWordParams): Promise<string> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = await import('docx');

  const children: InstanceType<typeof Paragraph | typeof Table>[] = [];

  // Title
  if (params.title) {
    children.push(
      new Paragraph({
        text: params.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  }

  const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };

  for (const block of params.blocks) {
    // Section heading
    if (block.heading) {
      children.push(
        new Paragraph({
          text: block.heading,
          heading: headingMap[block.heading_level ?? 1],
          spacing: { before: 300, after: 120 },
        })
      );
    }

    const blockItems = normalizeWordBlockItems(block.items);

    switch (inferWordBlockType(block)) {
      case 'paragraph': {
        if (block.text) {
          const lines = block.text.split('\n');
          for (const line of lines) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: line })],
                spacing: { after: 160 },
              })
            );
          }
        }
        break;
      }

      case 'bullet_list': {
        for (const item of blockItems) {
          children.push(
            new Paragraph({
              text: item,
              bullet: { level: 0 },
              spacing: { after: 80 },
            })
          );
        }
        break;
      }

      case 'numbered_list': {
        for (let i = 0; i < blockItems.length; i++) {
          children.push(
            new Paragraph({
              text: `${i + 1}. ${blockItems[i]}`,
              spacing: { after: 80 },
              indent: { left: 360 },
            })
          );
        }
        break;
      }

      case 'table': {
        if (block.table) {
          const { headers, rows } = block.table;
          const allRows: InstanceType<typeof TableRow>[] = [];

          // Header row
          allRows.push(
            new TableRow({
              tableHeader: true,
              children: headers.map(
                (h) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    shading: { fill: '1F4E79' },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  })
              ),
            })
          );

          // Data rows
          for (const row of rows) {
            allRows.push(
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ text: cell })],
                      margins: { top: 60, bottom: 60, left: 120, right: 120 },
                    })
                ),
              })
            );
          }

          children.push(
            new Table({
              rows: allRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
          );
          // Space after table
          children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        }
        break;
      }

      case 'page_break': {
        children.push(
          new Paragraph({
            pageBreakBefore: true,
            text: '',
          })
        );
        break;
      }
    }
  }

  const doc = new Document({
    creator: params.author || 'V-Coworker',
    title: params.title || 'Document',
    description: `Created by V-Coworker`,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const outDir = params.output_dir || defaultOutputDir();
  await ensureDir(outDir);
  const outPath = path.join(outDir, ensureExt(params.filename, '.docx'));

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outPath, buffer);
  return outPath;
}

// ─── PowerPoint ─────────────────────────────────────────────────────────────

interface PptBullet {
  text: string;
  level?: 0 | 1 | 2;
}

interface PptTableDef {
  headers: string[];
  rows: string[][];
}

interface PptChartSeries {
  name: string;
  values: number[];
}

interface PptChartDef {
  type: 'bar' | 'pie' | 'line' | 'doughnut';
  categories: string[];
  series: PptChartSeries[];
}

interface PptSlide {
  layout: 'title' | 'content' | 'two_column' | 'table' | 'chart' | 'blank';
  title?: string;
  subtitle?: string;
  bullets?: (string | PptBullet)[];
  left_bullets?: (string | PptBullet)[];
  right_bullets?: (string | PptBullet)[];
  table?: PptTableDef;
  chart?: PptChartDef;
  notes?: string;
}

interface CreatePresentationParams {
  filename: string;
  output_dir?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  theme_color?: string; // hex e.g. '1F4E79'
  slides: PptSlide[];
}

type WorkbookCellValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | Record<string, unknown>;

interface WorkbookRowLike {
  values: WorkbookCellValue[];
}

interface WorkbookWorksheetLike {
  name: string;
  eachRow: (
    options: { includeEmpty: boolean },
    callback: (row: WorkbookRowLike, rowNumber: number) => void
  ) => void;
}

interface WorkbookLike {
  worksheets: WorkbookWorksheetLike[];
}

interface RoadmapPack {
  sequence: number;
  packId: string;
  deliveryPack: string;
  department: string;
  wave: string;
  useCases: number;
  fteMonths: number;
  personDays: number;
  startM: string;
  endM: string;
  buildStarts: string;
  liveFrom: string;
  sourceReference: string;
}

interface UseCaseRecord {
  id: string;
  rowType: string;
  packId: string;
  deliveryPack: string;
  priority: string;
  planStatus: string;
  planYear: string;
  department: string;
  subArea: string;
  useCase: string;
  whatItDoes: string;
  action: string;
  aiCapability: string;
  primaryDataSources: string;
  dataReadiness: string;
  effort: string;
  wave: string;
  liveFrom: string;
  startM: string;
  endM: string;
  personDays: number;
  sourceReference: string;
}

function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function formatDays(value: number): string {
  return `${formatNumber(Math.round(value))} days`;
}

function cleanCellText(value: WorkbookCellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cleanCellText(value.result as WorkbookCellValue);
    if ('text' in value) return cleanCellText(value.text as WorkbookCellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) =>
          typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : ''
        )
        .join('')
        .trim();
    }
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function toNumber(value: string): number {
  const parsed = Number(String(value).replace(/[,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function worksheetRows(sheet: WorkbookWorksheetLike | undefined): string[][] {
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? Array.from(row.values.slice(1), cleanCellText) : [];
    if (values.some((value) => value.length > 0)) rows.push(values);
  });
  return rows;
}

function findSheet(workbook: WorkbookLike, namePart: string): WorkbookWorksheetLike | undefined {
  const needle = namePart.toLowerCase();
  return workbook.worksheets.find((sheet) => sheet.name.toLowerCase().includes(needle));
}

function findHeaderRow(rows: string[][], requiredColumns: string[]): number {
  const required = requiredColumns.map((column) => column.toLowerCase());
  return rows.findIndex((row) => {
    const normalized = Array.from(row, (cell) => String(cell || '').toLowerCase());
    return required.every((column) =>
      normalized.some((cell) => cell === column || cell.includes(column))
    );
  });
}

function getColumn(headers: string[], candidates: string[]): number {
  const normalized = Array.from(headers, (header) => String(header || '').toLowerCase());
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase();
    const exact = normalized.findIndex((header) => header === needle);
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((header) => header.includes(needle));
    if (partial >= 0) return partial;
  }
  return -1;
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? row[index] || '' : '';
}

function parseRoadmapPacks(rows: string[][]): RoadmapPack[] {
  const headerIndex = findHeaderRow(rows, ['Pack ID', 'Delivery pack']);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const idx = {
    sequence: getColumn(headers, ['#']),
    packId: getColumn(headers, ['Pack ID']),
    deliveryPack: getColumn(headers, ['Delivery pack']),
    department: getColumn(headers, ['Department']),
    wave: getColumn(headers, ['Wave / Action']),
    useCases: getColumn(headers, ['Use cases planned']),
    fteMonths: getColumn(headers, ['Effort (FTE-mo)']),
    personDays: getColumn(headers, ['Effort (person-days)']),
    startM: getColumn(headers, ['Start M']),
    endM: getColumn(headers, ['End M']),
    buildStarts: getColumn(headers, ['Build starts']),
    liveFrom: getColumn(headers, ['Live from']),
  };

  return rows
    .slice(headerIndex + 1)
    .filter((row) => toNumber(valueAt(row, idx.sequence)) > 0)
    .map((row) => {
      const sequence = toNumber(valueAt(row, idx.sequence));
      const packId = valueAt(row, idx.packId);
      return {
        sequence,
        packId,
        deliveryPack: valueAt(row, idx.deliveryPack),
        department: valueAt(row, idx.department),
        wave: valueAt(row, idx.wave),
        useCases: toNumber(valueAt(row, idx.useCases)),
        fteMonths: toNumber(valueAt(row, idx.fteMonths)),
        personDays: toNumber(valueAt(row, idx.personDays)),
        startM: valueAt(row, idx.startM),
        endM: valueAt(row, idx.endM),
        buildStarts: valueAt(row, idx.buildStarts),
        liveFrom: valueAt(row, idx.liveFrom),
        sourceReference: `Roadmap and Gantt | Pack ${packId || sequence}`,
      };
    })
    .filter((pack) => pack.packId && pack.deliveryPack);
}

function parseUseCases(rows: string[][]): UseCaseRecord[] {
  const headerIndex = findHeaderRow(rows, ['Planned Y/N', 'Use case']);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const idx = {
    planned: getColumn(headers, ['Planned Y/N']),
    id: getColumn(headers, ['UC ID']),
    packId: getColumn(headers, ['Pack ID']),
    deliveryPack: getColumn(headers, ['Delivery pack']),
    priority: getColumn(headers, ['Priority']),
    planStatus: getColumn(headers, ['Plan status']),
    planYear: getColumn(headers, ['Plan year']),
    department: getColumn(headers, ['Department']),
    subArea: getColumn(headers, ['Sub-area']),
    rowType: getColumn(headers, ['Row type']),
    useCase: getColumn(headers, ['Use case']),
    whatItDoes: getColumn(headers, ['What it does']),
    action: getColumn(headers, ['Action']),
    aiCapability: getColumn(headers, ['AI capability']),
    primaryDataSources: getColumn(headers, ['Primary data sources']),
    dataReadiness: getColumn(headers, ['Data readiness']),
    effort: getColumn(headers, ['Effort']),
    wave: getColumn(headers, ['Wave']),
    startM: getColumn(headers, ['Start M']),
    endM: getColumn(headers, ['End M']),
    liveFrom: getColumn(headers, ['Live from']),
    personDays: getColumn(headers, ['Effort (person-days)']),
  };

  return rows
    .slice(headerIndex + 1)
    .filter((row) => valueAt(row, idx.planned).toUpperCase() === 'Y')
    .map((row, offset) => {
      const id = valueAt(row, idx.id);
      return {
        id,
        rowType: valueAt(row, idx.rowType),
        packId: valueAt(row, idx.packId),
        deliveryPack: valueAt(row, idx.deliveryPack),
        priority: valueAt(row, idx.priority),
        planStatus: valueAt(row, idx.planStatus),
        planYear: valueAt(row, idx.planYear),
        department: valueAt(row, idx.department),
        subArea: valueAt(row, idx.subArea),
        useCase: valueAt(row, idx.useCase),
        whatItDoes: valueAt(row, idx.whatItDoes),
        action: valueAt(row, idx.action),
        aiCapability: valueAt(row, idx.aiCapability),
        primaryDataSources: valueAt(row, idx.primaryDataSources),
        dataReadiness: valueAt(row, idx.dataReadiness),
        effort: valueAt(row, idx.effort),
        wave: valueAt(row, idx.wave),
        startM: valueAt(row, idx.startM),
        endM: valueAt(row, idx.endM),
        liveFrom: valueAt(row, idx.liveFrom),
        personDays: toNumber(valueAt(row, idx.personDays)),
        sourceReference: `Use Case Master | ${id || `row ${headerIndex + offset + 2}`}`,
      };
    })
    .filter((record) => record.id && (record.useCase || record.deliveryPack)) as UseCaseRecord[];
}

function parseBusinessCase(rows: string[][]): {
  title: string;
  subtitle: string;
  metrics: string[];
  narrative: Array<{ label: string; text: string }>;
} {
  const titleRow = rows.find((row) => row.some((cell) => cell.toUpperCase().includes('ROADMAP')));
  const title = titleRow
    ? uniqueNonEmpty(titleRow).join(' ').replace(/\s+/g, ' ').trim()
    : 'Data & AI Roadmap';
  const metrics =
    rows
      .find((row) => row.some((cell) => /use cases|person-days|live|parked/i.test(cell)))
      ?.filter((cell) => !cell.toUpperCase().includes('ROADMAP'))
      .filter(Boolean)
      .filter((cell, index, values) => values.indexOf(cell) === index)
      .map((cell) => truncateText(cell, 92)) || [];
  const narrative = rows
    .filter((row) => row.length >= 3 && row[1] && row[2] && row[2].length > 30)
    .map((row) => ({ label: row[1], text: row[2] }))
    .filter((item) => item.label !== item.text)
    .filter((item) => !item.label.toUpperCase().includes('ROADMAP'))
    .filter((item) => !/^[A-Z]\s*·/.test(item.label))
    .slice(0, 12);

  return {
    title: title.replace(/\s*\|\s*/g, ' ').slice(0, 90),
    subtitle: 'Roadmap plan generated from workbook source data',
    metrics,
    narrative,
  };
}

function waveSummaryTable(packs: RoadmapPack[]): PptTableDef {
  const waves = new Map<
    string,
    { packs: number; useCases: number; fteMonths: number; personDays: number }
  >();
  for (const pack of packs) {
    const key = pack.wave || 'Unassigned';
    const current = waves.get(key) || { packs: 0, useCases: 0, fteMonths: 0, personDays: 0 };
    current.packs += 1;
    current.useCases += pack.useCases;
    current.fteMonths += pack.fteMonths;
    current.personDays += pack.personDays;
    waves.set(key, current);
  }

  return {
    headers: ['Wave', 'Packs', 'Use cases', 'FTE-mo', 'Person-days'],
    rows: Array.from(waves.entries()).map(([wave, values]) => [
      truncateText(wave, 42),
      String(values.packs),
      formatNumber(values.useCases),
      formatNumber(values.fteMonths, 1),
      formatDays(values.personDays),
    ]),
  };
}

function currentWipTable(rows: string[][]): PptTableDef | null {
  if (rows.length < 2) return null;
  const headers = rows[0];
  const idx = {
    desc: getColumn(headers, ['Desc']),
    who: getColumn(headers, ['Who']),
    date: getColumn(headers, ['Date Opened']),
    exp: getColumn(headers, ['Exp Date']),
  };
  const body = rows
    .slice(1)
    .filter((row) => valueAt(row, idx.desc))
    .slice(0, 7)
    .map((row) => [
      truncateText(valueAt(row, idx.desc), 42),
      truncateText(valueAt(row, idx.who), 22),
      valueAt(row, idx.date).slice(0, 10),
      valueAt(row, idx.exp).slice(0, 10),
    ]);
  if (body.length === 0) return null;
  return { headers: ['Work item', 'Owner', 'Opened', 'Target'], rows: body };
}

function findGenericHeaderRow(rows: string[][]): number {
  const scanRows = rows.slice(0, Math.min(rows.length, 25));
  let bestIndex = -1;
  let bestScore = 0;

  scanRows.forEach((row, index) => {
    const nonEmpty = row.filter(Boolean).length;
    const nextNonEmpty = rows[index + 1]?.filter(Boolean).length || 0;
    const score = nonEmpty + Math.min(nextNonEmpty, nonEmpty);
    if (nonEmpty >= 2 && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex >= 0 ? bestIndex : 0;
}

function genericWorkbookPresentation(
  workbook: WorkbookLike,
  sourceFile: string,
  filename: string
): CreatePresentationParams | null {
  const sheetProfiles = workbook.worksheets
    .map((sheet) => {
      const rows = worksheetRows(sheet).slice(0, 250);
      if (rows.length === 0) return null;

      const headerIndex = findGenericHeaderRow(rows);
      const rawHeaders = rows[headerIndex] || [];
      const headers = rawHeaders
        .map((header, index) => header || `Column ${index + 1}`)
        .filter(Boolean);
      const dataRows = rows
        .slice(headerIndex + 1)
        .filter((row) => row.some(Boolean))
        .map((row) => row.map((cell) => truncateText(cell, 90)));

      return {
        name: sheet.name,
        rows,
        headers,
        dataRows,
        dataRowCount: dataRows.length,
        columnCount: Math.max(...rows.map((row) => row.length), headers.length),
      };
    })
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));

  if (sheetProfiles.length === 0) return null;

  const slides: PptSlide[] = [
    {
      layout: 'content',
      title: 'Workbook Overview',
      bullets: [
        `Source file: ${path.basename(sourceFile)}`,
        `${sheetProfiles.length} worksheet(s) parsed from the attached workbook.`,
        ...sheetProfiles
          .slice(0, 6)
          .map(
            (sheet) =>
              `${sheet.name}: ${formatNumber(sheet.dataRowCount)} data row(s), ${formatNumber(sheet.columnCount)} column(s).`
          ),
      ],
    },
    {
      layout: 'table',
      title: 'Sheet Inventory',
      table: {
        headers: ['Sheet', 'Rows', 'Columns', 'Key fields'],
        rows: sheetProfiles.map((sheet) => [
          truncateText(sheet.name, 30),
          formatNumber(sheet.dataRowCount),
          formatNumber(sheet.columnCount),
          truncateText(sheet.headers.slice(0, 6).join(', '), 70),
        ]),
      },
    },
  ];

  for (const sheet of sheetProfiles.slice(0, 5)) {
    const headers = sheet.headers.slice(0, 5);
    const rows = sheet.dataRows
      .slice(0, 8)
      .map((row) => headers.map((_, index) => row[index] || ''));
    if (headers.length === 0 || rows.length === 0) continue;

    slides.push({
      layout: 'table',
      title: truncateText(sheet.name, 50),
      table: {
        headers,
        rows,
      },
    });
  }

  return {
    filename,
    title: path.basename(sourceFile, path.extname(sourceFile)),
    subtitle: 'Presentation generated from attached workbook sheets',
    slides,
  };
}

async function generateExcelWbsFromWorkbookSource(
  sourceFile: string,
  filename: string
): Promise<CreateExcelParams | null> {
  const ext = path.extname(sourceFile).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xlsm' && ext !== '.xls') return null;

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.readFile(sourceFile);
  const workbookLike = workbook as unknown as WorkbookLike;

  const businessRows = worksheetRows(findSheet(workbookLike, 'plan and business'));
  const roadmapRows = worksheetRows(findSheet(workbookLike, 'roadmap'));
  const useCaseRows = worksheetRows(findSheet(workbookLike, 'use case'));
  const wipRows = worksheetRows(findSheet(workbookLike, 'current wip'));

  const business = parseBusinessCase(businessRows);
  const packs = parseRoadmapPacks(roadmapRows);
  const useCases = parseUseCases(useCaseRows);
  const wip = currentWipTable(wipRows);

  if (packs.length === 0 && useCases.length === 0) return null;

  const useCasesByPack = new Map<string, UseCaseRecord[]>();
  for (const useCase of useCases) {
    const items = useCasesByPack.get(useCase.packId) || [];
    items.push(useCase);
    useCasesByPack.set(useCase.packId, items);
  }

  const packsById = new Map(packs.map((pack) => [pack.packId, pack]));
  const packIds = uniqueNonEmpty([
    ...packs.map((pack) => pack.packId),
    ...useCases.map((useCase) => useCase.packId),
  ]);
  const totalDays = packs.reduce((sum, pack) => sum + pack.personDays, 0);
  const totalFteMonths = packs.reduce((sum, pack) => sum + pack.fteMonths, 0);
  const wbsRows: (string | number)[][] = [];
  let workstreamNo = 0;

  for (const packId of packIds) {
    const pack = packsById.get(packId);
    const packUseCases = useCasesByPack.get(packId) || [];
    const firstUseCase = packUseCases[0];
    workstreamNo += 1;
    const packWbsId = `${workstreamNo}.0`;
    const packTask = pack?.deliveryPack || firstUseCase?.deliveryPack || packId;
    const packDepartment = pack?.department || firstUseCase?.department || '';
    const packWave = pack?.wave || firstUseCase?.wave || '';
    const packStart = pack?.startM || firstUseCase?.startM || '';
    const packFinish =
      pack?.liveFrom || pack?.endM || firstUseCase?.liveFrom || firstUseCase?.endM || '';
    const packDays =
      pack?.personDays || packUseCases.reduce((sum, useCase) => sum + useCase.personDays, 0);

    wbsRows.push([
      packWbsId,
      2,
      '',
      'Delivery pack',
      packId,
      packTask,
      packDepartment,
      '',
      packWave,
      packStart,
      packFinish,
      pack?.fteMonths ? Number(pack.fteMonths.toFixed(2)) : '',
      Math.round(packDays),
      '',
      '',
      '',
      '',
      pack?.sourceReference || firstUseCase?.sourceReference || '',
    ]);

    packUseCases.forEach((useCase, index) => {
      wbsRows.push([
        `${workstreamNo}.${index + 1}`,
        3,
        packWbsId,
        useCase.rowType || 'Source row',
        useCase.packId,
        useCase.useCase,
        useCase.department,
        useCase.subArea,
        useCase.wave || pack?.wave || '',
        useCase.startM || '',
        useCase.liveFrom || useCase.endM || '',
        useCase.effort,
        Math.round(useCase.personDays),
        truncateText(useCase.aiCapability, 80),
        truncateText(useCase.action || useCase.whatItDoes, 160),
        truncateText(useCase.primaryDataSources, 140),
        truncateText(useCase.dataReadiness || useCase.planStatus || useCase.planYear, 140),
        useCase.sourceReference,
      ]);
    });
  }

  const waveRows = waveSummaryTable(packs).rows.map((row) => [
    row[0],
    Number(row[1]) || 0,
    Number(row[2]) || 0,
    Number(row[3]) || 0,
    row[4],
  ]);

  const wipRowsForExcel = wip?.rows.map((row) => [row[0], row[1], row[2], row[3]]) || [];

  const roadmapPackRows = packs.map((pack) => [
    pack.sequence,
    pack.packId,
    pack.deliveryPack,
    pack.department,
    pack.wave,
    pack.useCases,
    Number(pack.fteMonths.toFixed(2)),
    Math.round(pack.personDays),
    pack.startM,
    pack.endM,
    pack.buildStarts,
    pack.liveFrom,
    pack.sourceReference,
  ]);

  const plannedSourceRows = useCases.map((useCase) => [
    useCase.id,
    useCase.rowType,
    useCase.packId,
    useCase.deliveryPack,
    useCase.priority,
    useCase.planStatus,
    useCase.planYear,
    useCase.department,
    useCase.subArea,
    useCase.useCase,
    truncateText(useCase.whatItDoes, 180),
    useCase.action,
    useCase.aiCapability,
    useCase.primaryDataSources,
    useCase.dataReadiness,
    useCase.effort,
    Math.round(useCase.personDays),
    useCase.wave,
    useCase.startM,
    useCase.endM,
    useCase.liveFrom,
    useCase.sourceReference,
  ]);

  return {
    filename,
    sheets: [
      {
        name: 'WBS Summary',
        headers: ['Metric', 'Value'],
        rows: [
          ['Source workbook', path.basename(sourceFile)],
          ['Roadmap title', business.title],
          ['Delivery packs', packs.length],
          ['Planned source rows parsed', useCases.length],
          ['WBS parent task rows', packIds.length],
          ['WBS source subtask rows', useCases.length],
          ['Pack-row effort subtotal', Math.round(totalDays)],
          ['Pack-row FTE months subtotal', Number(totalFteMonths.toFixed(1))],
          ['Roadmap source summary', business.metrics.join(' | ')],
        ],
        column_widths: [34, 110],
      },
      {
        name: 'Detailed WBS',
        headers: [
          'WBS ID',
          'Level',
          'Parent WBS',
          'Source Row Type',
          'Pack ID',
          'Task / Subtask',
          'Department',
          'Sub-area',
          'Wave',
          'Start',
          'Finish / Live',
          'Effort',
          'Effort Days',
          'AI Capability',
          'Source Action / What It Does',
          'Primary Data Sources',
          'Data Readiness / Status',
          'Source Reference',
        ],
        rows: wbsRows,
        column_widths: [10, 8, 12, 18, 12, 52, 26, 34, 32, 12, 16, 12, 14, 28, 58, 42, 42, 34],
        freeze_header: true,
      },
      {
        name: 'Roadmap Packs',
        headers: [
          'Sequence',
          'Pack ID',
          'Delivery pack',
          'Department',
          'Wave',
          'Use cases planned',
          'Effort FTE-mo',
          'Effort person-days',
          'Start M',
          'End M',
          'Build starts',
          'Live from',
          'Source Reference',
        ],
        rows: roadmapPackRows,
        column_widths: [10, 12, 58, 26, 34, 18, 16, 18, 12, 12, 16, 16, 34],
      },
      {
        name: 'Planned Source Rows',
        headers: [
          'UC ID',
          'Row type',
          'Pack ID',
          'Delivery pack',
          'Priority',
          'Plan status',
          'Plan year',
          'Department',
          'Sub-area',
          'Use case',
          'What it does',
          'Action',
          'AI capability',
          'Primary data sources',
          'Data readiness',
          'Effort',
          'Effort person-days',
          'Wave',
          'Start M',
          'End M',
          'Live from',
          'Source Reference',
        ],
        rows: plannedSourceRows,
        column_widths: [
          14, 18, 12, 48, 12, 18, 24, 24, 36, 48, 64, 18, 28, 36, 34, 12, 18, 32, 12, 12, 16, 34,
        ],
      },
      {
        name: 'Wave Summary',
        headers: ['Wave', 'Packs', 'Use cases', 'FTE months', 'Person-days'],
        rows: waveRows,
        column_widths: [44, 12, 14, 14, 18],
      },
      {
        name: 'Current WIP',
        headers: ['Work Item', 'Owner', 'Opened', 'Target'],
        rows: wipRowsForExcel,
        column_widths: [52, 24, 16, 16],
      },
    ],
  };
}

// ─── General-purpose Gantt/Roadmap generation (no source workbook needed) ────

interface GanttTask {
  name: string;
  phase?: string;
  owner?: string;
  start: Date;
  end: Date;
}

// Caps the number of day-columns rendered, in case the model returns an
// unrealistically wide date range — keeps the sheet usable instead of
// generating hundreds of near-empty columns.
const MAX_GANTT_DAYS = 180;

async function generateGanttRoadmapFromDescription(
  desc: string,
  filename: string
): Promise<CreateExcelParams | null> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    {
      role: 'system',
      content: `You are a project planner. Break the request into a task list for a project roadmap/Gantt chart.
Return ONLY valid JSON, no markdown fences.
Schema: {"tasks":[{"name":"Task name","phase":"Phase name","owner":"Owner or team","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"}]}
Use realistic sequential dates, at least 5 tasks, end_date must be on or after start_date for every task.`,
    },
    { role: 'user', content: `Create a project roadmap for: ${desc}` },
  ];

  let tasks: GanttTask[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptMessages =
      attempt === 0
        ? messages
        : messages.map((m, i) =>
            i === 0 ? { ...m, content: m.content + STRICT_RETRY_REMINDER } : m
          );
    const content = await callOllamaChat(attemptMessages, {
      model: pickModelForTask('simple'),
      timeoutMs: 120000,
      numPredict: 4000,
    });
    if (!content) continue;
    const json = extractJsonObject(content);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as { tasks?: unknown };
      if (!Array.isArray(parsed.tasks)) continue;
      const parsedTasks: GanttTask[] = [];
      for (const raw of parsed.tasks) {
        if (!raw || typeof raw !== 'object') continue;
        const t = raw as Record<string, unknown>;
        const name = typeof t.name === 'string' ? t.name.trim() : '';
        const start = parseIsoDate(t.start_date);
        const end = parseIsoDate(t.end_date);
        if (!name || !start || !end || end.getTime() < start.getTime()) continue;
        parsedTasks.push({
          name,
          phase: typeof t.phase === 'string' ? t.phase.trim() : undefined,
          owner: typeof t.owner === 'string' ? t.owner.trim() : undefined,
          start,
          end,
        });
      }
      if (parsedTasks.length > 0) {
        tasks = parsedTasks;
        break;
      }
    } catch {
      continue;
    }
  }
  if (tasks.length === 0) return null;

  const wbsRows: ExcelCellValue[][] = tasks.map((t) => [
    t.name,
    t.phase || '',
    t.owner || '',
    isoDate(t.start),
    isoDate(t.end),
    Math.round((t.end.getTime() - t.start.getTime()) / 86_400_000) + 1,
  ]);

  const minStart = new Date(Math.min(...tasks.map((t) => t.start.getTime())));
  let maxEnd = new Date(Math.max(...tasks.map((t) => t.end.getTime())));
  const totalDays = Math.round((maxEnd.getTime() - minStart.getTime()) / 86_400_000) + 1;
  if (totalDays > MAX_GANTT_DAYS) {
    maxEnd = new Date(minStart.getTime() + (MAX_GANTT_DAYS - 1) * 86_400_000);
  }

  const headerDates: Date[] = [];
  for (
    const d = new Date(minStart);
    d.getTime() <= maxEnd.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    headerDates.push(new Date(d));
  }

  const ganttHeaders = ['Task', ...headerDates.map((d) => isoDate(d))];
  const ganttRows: ExcelCellValue[][] = tasks.map((t) => [t.name, ...headerDates.map(() => '')]);
  const ganttBars: ExcelGanttBar[] = [];
  tasks.forEach((t, idx) => {
    const cols = computeGanttBarColumns(headerDates, t.start, t.end);
    if (cols) {
      ganttBars.push({ row: idx + 2, startCol: cols.startCol, endCol: cols.endCol });
    }
  });

  return {
    filename,
    sheets: [
      {
        name: 'WBS',
        headers: ['Task', 'Phase', 'Owner', 'Start', 'End', 'Duration (days)'],
        rows: wbsRows,
        column_widths: [40, 20, 20, 14, 14, 16],
      },
      {
        name: 'Gantt',
        headers: ganttHeaders,
        rows: ganttRows,
        column_widths: [40, ...headerDates.map(() => 4)],
        ganttBars,
      },
    ],
  };
}

async function generatePresentationFromWorkbookSource(
  sourceFile: string,
  filename: string
): Promise<CreatePresentationParams | null> {
  const ext = path.extname(sourceFile).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xlsm' && ext !== '.xls') return null;

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.readFile(sourceFile);
  const workbookLike = workbook as unknown as WorkbookLike;

  const businessRows = worksheetRows(findSheet(workbookLike, 'plan and business'));
  const roadmapRows = worksheetRows(findSheet(workbookLike, 'roadmap'));
  const useCaseRows = worksheetRows(findSheet(workbookLike, 'use case'));
  const wipRows = worksheetRows(findSheet(workbookLike, 'current wip'));

  const business = parseBusinessCase(businessRows);
  const packs = parseRoadmapPacks(roadmapRows);
  const useCases = parseUseCases(useCaseRows);
  const wip = currentWipTable(wipRows);
  const totalDays = packs.reduce((sum, pack) => sum + pack.personDays, 0);
  const totalFteMonths = packs.reduce((sum, pack) => sum + pack.fteMonths, 0);

  if (packs.length === 0 && useCases.length === 0) {
    return genericWorkbookPresentation(workbookLike, sourceFile, filename);
  }

  const sourceNarrativeBullets = business.narrative
    .map((item) => `${item.label}: ${truncateText(item.text, 185)}`)
    .slice(0, 7);
  const dataReadinessRows = Array.from(
    useCases.reduce((summary, useCase) => {
      const key = useCase.dataReadiness || useCase.planStatus || 'Unspecified';
      summary.set(key, (summary.get(key) || 0) + 1);
      return summary;
    }, new Map<string, number>())
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([status, count]) => [truncateText(status, 56), String(count)]);

  const slides: PptSlide[] = [
    {
      layout: 'content',
      title: 'Executive Summary',
      bullets: [
        ...business.metrics.slice(0, 4),
        `${formatNumber(packs.length)} roadmap packs and ${formatNumber(useCases.length)} planned source rows parsed from ${path.basename(sourceFile)}.`,
        `${formatDays(totalDays)} and ${formatNumber(totalFteMonths, 1)} FTE-months in the roadmap pack rows.`,
      ].filter(Boolean),
    },
    {
      layout: 'table',
      title: 'Roadmap by Wave',
      table: waveSummaryTable(packs),
    },
  ];

  if (sourceNarrativeBullets.length > 0) {
    slides.push({
      layout: 'content',
      title: 'Source Narrative',
      bullets: sourceNarrativeBullets,
    });
  }

  if (packs.length > 0) {
    slides.push({
      layout: 'table',
      title: 'Roadmap Packs',
      table: {
        headers: ['Pack', 'Delivery pack', 'Wave', 'Person-days'],
        rows: packs
          .slice(0, 9)
          .map((pack) => [
            pack.packId,
            truncateText(pack.deliveryPack, 42),
            truncateText(pack.wave, 26),
            formatDays(pack.personDays),
          ]),
      },
    });
  }

  if (useCases.length > 0) {
    slides.push({
      layout: 'table',
      title: 'Planned Source Rows',
      table: {
        headers: ['ID', 'Type', 'Task / Subtask', 'Live from'],
        rows: useCases
          .slice(0, 8)
          .map((useCase) => [
            useCase.id,
            truncateText(useCase.rowType, 18),
            truncateText(useCase.useCase, 42),
            useCase.liveFrom || '-',
          ]),
      },
    });
  }

  if (dataReadinessRows.length > 0) {
    slides.push({
      layout: 'table',
      title: 'Data Readiness Summary',
      table: {
        headers: ['Source status', 'Rows'],
        rows: dataReadinessRows,
      },
    });
  }

  if (wip) {
    slides.push({
      layout: 'table',
      title: 'Current WIP and Open Decisions',
      table: wip,
    });
  }

  return {
    filename,
    title: business.title || path.basename(sourceFile, path.extname(sourceFile)),
    subtitle: business.subtitle,
    slides,
  };
}

async function createPresentation(params: CreatePresentationParams): Promise<string> {
  const pptxgen = await import('pptxgenjs');
  const prs = new pptxgen.default();

  const THEME = params.theme_color || '1F4E79';
  const THEME_LIGHT = 'D6E4F0';
  const ACCENT = '2E74B5';

  prs.author = params.author || 'V-Coworker';
  prs.title = params.title || 'Presentation';

  // Define master layout
  prs.defineSlideMaster({
    title: 'DSR_MASTER',
    background: { color: 'FFFFFF' },
    objects: [
      // Footer bar
      { rect: { x: 0, y: 6.9, w: '100%', h: 0.6, fill: { color: THEME } } },
      // Footer text
      {
        text: {
          text: params.title || 'V-Coworker',
          options: {
            x: 0.3,
            y: 6.95,
            w: 8,
            h: 0.5,
            color: 'FFFFFF',
            fontSize: 10,
            fontFace: 'Calibri',
          },
        },
      },
    ],
  });

  // Add title slide if title is provided
  if (params.title || params.subtitle) {
    const titleSlide = prs.addSlide();
    // Full background header
    titleSlide.addShape(prs.ShapeType.rect, {
      x: 0,
      y: 0,
      w: '100%',
      h: 4.0,
      fill: { color: THEME },
    });
    titleSlide.addText(params.title || '', {
      x: 0.5,
      y: 1.0,
      w: 9.0,
      h: 1.5,
      color: 'FFFFFF',
      fontSize: 36,
      bold: true,
      fontFace: 'Calibri',
      align: 'center',
      valign: 'middle',
    });
    if (params.subtitle) {
      titleSlide.addText(params.subtitle, {
        x: 0.5,
        y: 2.6,
        w: 9.0,
        h: 0.8,
        color: 'DCE6F1',
        fontSize: 20,
        fontFace: 'Calibri',
        align: 'center',
      });
    }
    titleSlide.addText('V-Coworker', {
      x: 0.5,
      y: 4.5,
      w: 9.0,
      h: 0.5,
      color: '595959',
      fontSize: 12,
      fontFace: 'Calibri',
      align: 'center',
    });
  }

  function normBullet(b: string | PptBullet): PptBullet {
    return typeof b === 'string' ? { text: b, level: 0 } : b;
  }

  for (const slide of params.slides) {
    const s = prs.addSlide();

    switch (slide.layout) {
      case 'title': {
        s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 3.5, fill: { color: THEME } });
        s.addText(slide.title || '', {
          x: 0.5,
          y: 0.8,
          w: 9.0,
          h: 1.5,
          color: 'FFFFFF',
          fontSize: 32,
          bold: true,
          fontFace: 'Calibri',
          align: 'center',
          valign: 'middle',
        });
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5,
            y: 2.4,
            w: 9.0,
            h: 0.8,
            color: 'DCE6F1',
            fontSize: 18,
            fontFace: 'Calibri',
            align: 'center',
          });
        }
        break;
      }

      case 'content': {
        // Title bar
        s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: THEME } });
        s.addText(slide.title || '', {
          x: 0.3,
          y: 0.1,
          w: 9.4,
          h: 0.9,
          color: 'FFFFFF',
          fontSize: 24,
          bold: true,
          fontFace: 'Calibri',
          valign: 'middle',
        });
        // Bullets
        const bullets = (slide.bullets || []).map((b) => {
          const nb = normBullet(b);
          return {
            text: nb.text,
            options: {
              bullet: { indent: (nb.level || 0) * 20 + 15 },
              fontSize: nb.level === 0 ? 18 : 16,
              color: nb.level === 0 ? '1F2937' : '4B5563',
              breakLine: true,
            },
          };
        });
        if (bullets.length > 0) {
          s.addText(bullets, {
            x: 0.5,
            y: 1.3,
            w: 9.0,
            h: 5.2,
            fontFace: 'Calibri',
            valign: 'top',
          });
        }
        break;
      }

      case 'two_column': {
        s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: THEME } });
        s.addText(slide.title || '', {
          x: 0.3,
          y: 0.1,
          w: 9.4,
          h: 0.9,
          color: 'FFFFFF',
          fontSize: 24,
          bold: true,
          fontFace: 'Calibri',
          valign: 'middle',
        });
        // Divider
        s.addShape(prs.ShapeType.rect, {
          x: 4.9,
          y: 1.2,
          w: 0.05,
          h: 5.4,
          fill: { color: ACCENT },
        });

        const mkBullets = (items: (string | PptBullet)[] = []) =>
          items.map((b) => {
            const nb = normBullet(b);
            return {
              text: nb.text,
              options: { bullet: { indent: 15 }, fontSize: 16, color: '1F2937', breakLine: true },
            };
          });

        if (slide.left_bullets && slide.left_bullets.length > 0) {
          s.addText(mkBullets(slide.left_bullets), {
            x: 0.3,
            y: 1.3,
            w: 4.4,
            h: 5.2,
            fontFace: 'Calibri',
            valign: 'top',
          });
        }
        if (slide.right_bullets && slide.right_bullets.length > 0) {
          s.addText(mkBullets(slide.right_bullets), {
            x: 5.1,
            y: 1.3,
            w: 4.6,
            h: 5.2,
            fontFace: 'Calibri',
            valign: 'top',
          });
        }
        break;
      }

      case 'table': {
        s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: THEME } });
        s.addText(slide.title || '', {
          x: 0.3,
          y: 0.1,
          w: 9.4,
          h: 0.9,
          color: 'FFFFFF',
          fontSize: 24,
          bold: true,
          fontFace: 'Calibri',
          valign: 'middle',
        });
        if (slide.table) {
          const { headers, rows } = slide.table;
          const tableData = [
            headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                color: 'FFFFFF',
                fill: { color: THEME },
                align: 'center' as const,
              },
            })),
            ...rows.map((row, ri) =>
              row.map((cell) => ({
                text: cell,
                options: { fill: { color: ri % 2 === 0 ? THEME_LIGHT : 'FFFFFF' }, fontSize: 14 },
              }))
            ),
          ];
          s.addTable(tableData, {
            x: 0.3,
            y: 1.3,
            w: 9.4,
            fontFace: 'Calibri',
            fontSize: 14,
            border: { type: 'solid', color: 'BDD7EE', pt: 1 },
          });
        }
        break;
      }

      case 'chart': {
        s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: THEME } });
        s.addText(slide.title || '', {
          x: 0.3,
          y: 0.1,
          w: 9.4,
          h: 0.9,
          color: 'FFFFFF',
          fontSize: 24,
          bold: true,
          fontFace: 'Calibri',
          valign: 'middle',
        });
        if (slide.chart && slide.chart.series.length > 0 && slide.chart.categories.length > 0) {
          const chartData = slide.chart.series.map((series) => ({
            name: series.name,
            labels: slide.chart!.categories,
            values: series.values,
          }));
          s.addChart(slide.chart.type, chartData, {
            x: 0.5,
            y: 1.3,
            w: 9.0,
            h: 5.2,
            showLegend: slide.chart.series.length > 1,
            legendPos: 'b',
            showTitle: false,
            chartColors: [THEME, ACCENT, 'FFD966', '9DC3E6', 'D6E4F0'],
          });
        }
        break;
      }

      case 'blank': {
        if (slide.title) {
          s.addText(slide.title, {
            x: 0.5,
            y: 0.5,
            w: 9.0,
            h: 1.0,
            color: THEME,
            fontSize: 28,
            bold: true,
            fontFace: 'Calibri',
          });
        }
        break;
      }
    }

    // Speaker notes
    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  const outDir = params.output_dir || defaultOutputDir();
  await ensureDir(outDir);
  const outFile = path.join(outDir, ensureExt(params.filename, '.pptx'));
  await prs.writeFile({ fileName: outFile });
  return outFile;
}

// ─── AI-Powered Dynamic Content Generation ───────────────────────────────────

/**
 * Calls Ollama (gemma4:e4b) to generate document content from a description.
 * Returns the raw JSON string, or null if the call fails / returns non-JSON.
 * The caller must parse and validate before use; template generators are the fallback.
 */
/** Clean up raw tab-separated file content for Ollama — remove empty columns, collapse whitespace */
function cleanFileContent(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      // Split on tabs, drop empty trailing cells, rejoin with " | "
      const cells = line.split('\t').map((c) => c.trim());
      const nonEmpty = cells.filter((c) => c && c !== 'None' && c !== 'undefined');
      return nonEmpty.join(' | ');
    })
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, 6000); // cap at 6000 chars for Ollama context
}

/**
 * One retry attempt with a stricter, placeholder-forbidding reminder appended
 * to the system prompt — used when the first response fails
 * validateGeneratedContent() (invalid JSON or bracket/generic placeholder text).
 */
const STRICT_RETRY_REMINDER =
  '\n\nYour previous answer contained a placeholder (e.g. "[X]", "[Goal]", "$X", "Key win", "Challenge 1") or was not valid JSON. This is not acceptable. Return ONLY valid JSON with concrete, specific content — every value must be a real fact, number, or sentence, never a bracketed stand-in.';

async function callOllamaForContent(
  description: string,
  docType: 'excel' | 'word' | 'ppt'
): Promise<string | null> {
  // Detect file-content injection from tryDirectOfficeToolCall
  const FILE_SEP = '=== CONTENT FROM ATTACHED FILE';
  const hasFile = description.includes(FILE_SEP);

  let model: string;
  let messages: Array<{ role: string; content: string }>;

  if (hasFile) {
    // Split into user request and raw file content
    const sepIdx = description.indexOf(FILE_SEP);
    const userRequest = description
      .slice(0, sepIdx)
      .replace(/^User request:\s*/i, '')
      .trim();
    const rawFileBlock = description.slice(sepIdx);
    const fileContent = cleanFileContent(rawFileBlock);

    // Use the more capable model for file-based generation
    model = pickModelForTask('complex');

    const fileSchemas: Record<string, string> = {
      excel: `{"sheets":[{"name":"SheetName","headers":["Col1","Col2"],"rows":[["actual value","actual value"]],"freeze_header":true,"chart":{"value_column":1}}]}`,
      word: `{"title":"Actual document title","blocks":[{"type":"paragraph","heading":"Section","heading_level":1,"text":"Actual content from file"},{"type":"bullet_list","items":["Actual fact from file"]}]}`,
      ppt: `{"title":"Actual title from file","subtitle":"Actual subtitle","slides":[{"layout":"content","title":"Actual slide title","bullets":["Actual fact: specific number or detail from file"]},{"layout":"table","title":"Data Table","table":{"headers":["Col A","Col B"],"rows":[["actual","actual"]]}},{"layout":"chart","title":"Trend","chart":{"type":"bar","categories":["actual","actual"],"series":[{"name":"Actual metric","values":[0,0]}]}}]}`,
    };

    const fileInstructions: Record<string, string> = {
      excel: `Extract data from the file content below and organize it into Excel sheets.
Every row must contain ACTUAL values from the file — no placeholders, no invented data.
If a sheet has a clear numeric column worth visualizing, add "chart":{"value_column":N} (0-based index) to that sheet — omit "chart" entirely otherwise.`,
      word: `Extract key information from the file content below and write a professional document.
Every section must contain ACTUAL content from the file — no [brackets], no invented text.`,
      ppt: `Extract key facts from the file content below and create presentation slides.
STRICT RULES:
- Every bullet must state an ACTUAL fact from the file (real numbers, real names, real dates)
- NEVER write "$X", "[Goal]", "[Achievement]", "Key win", "Challenge 1" or any generic placeholder
- The title must be the actual project/document name found in the file
- Include the actual timeline, phases, teams, metrics — whatever is in the file
- If the file contains a clear numeric series (metrics over time, category comparisons), add one "layout":"chart" slide with real categories/values instead of a generic bullet slide`,
    };

    messages = [
      {
        role: 'system',
        content: `You convert file data into structured document content. Return ONLY valid JSON — no markdown fences, no explanation, no preamble.
Schema: ${fileSchemas[docType]}
${fileInstructions[docType]}`,
      },
      {
        role: 'user',
        content: `FILE CONTENT:\n${fileContent}\n\nTASK: ${userRequest || `Create a ${docType === 'ppt' ? 'presentation' : docType === 'excel' ? 'spreadsheet' : 'document'} from this file data.`}`,
      },
    ];
  } else {
    // No file — plain description, use the fast model
    model = pickModelForTask('simple');

    const plainPrompts: Record<string, string> = {
      excel: `You are a data analyst. Generate Excel spreadsheet data as JSON.
Return ONLY valid JSON, no markdown fences.
Schema: {"sheets":[{"name":"SheetName","headers":["Col1","Col2","Col3"],"rows":[["val","val",0]],"freeze_header":true,"chart":{"value_column":2}}]}
Use specific realistic data — at least 8–15 rows. Row values must align with headers.
"chart" is optional — include it only on a sheet with a meaningful numeric column (value_column is its 0-based index), omit it otherwise.`,
      word: `You are a professional writer. Generate Word document content as JSON.
Return ONLY valid JSON, no markdown fences.
Schema: {"title":"Title","blocks":[{"type":"paragraph","heading":"Section","heading_level":1,"text":"Content"},{"type":"bullet_list","items":["Point 1"]}]}
Write real professional content — no placeholder text. Include at least 5 sections.`,
      ppt: `You are a presentation designer. Generate PowerPoint content as JSON.
Return ONLY valid JSON, no markdown fences.
Schema: {"title":"Title","subtitle":"Subtitle","slides":[{"layout":"content","title":"Slide","bullets":["Specific point"]},{"layout":"table","title":"Data","table":{"headers":["A","B"],"rows":[["val","val"]]}},{"layout":"chart","title":"Chart title","chart":{"type":"bar","categories":["Q1","Q2"],"series":[{"name":"Revenue","values":[10,20]}]}}]}
Layouts: content|table|two_column|chart|blank. Write specific bullets — no generic placeholders. Include one chart slide only if there's a real metric worth visualizing. 5–7 slides.`,
    };

    messages = [
      { role: 'system', content: plainPrompts[docType] },
      { role: 'user', content: `Create: ${description}` },
    ];
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptMessages =
      attempt === 0
        ? messages
        : messages.map((m, i) =>
            i === 0 ? { ...m, content: m.content + STRICT_RETRY_REMINDER } : m
          );

    const content = await callOllamaChat(
      attemptMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      { model, timeoutMs: 120000, numPredict: 4000 }
    );
    if (!content) {
      continue; // network/timeout/HTTP failure — retry once, then fall back
    }
    const json = extractJsonObject(content);
    if (!json) {
      continue;
    }
    const validation = validateGeneratedContent(json);
    if (validation.valid) {
      return json;
    }
    // Invalid on first attempt: retry with a stricter prompt. Invalid again: give up
    // and let the caller fall back to a hardcoded template generator.
  }
  return null;
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

function createMcpServer() {
  const server = new Server(
    { name: 'office-tools-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'create_excel',
          description:
            'Create an Excel (.xlsx) spreadsheet with one or more sheets. Supports styled headers, data rows, auto-totals, column widths, frozen header rows, and live formula cells (e.g. NPV, IRR, STDEV, AVERAGE, TREND, growth-rate calculations). Use this whenever the user asks for a spreadsheet, table of data, financial model, statistical analysis, report, tracker, or anything in Excel format. Mentioning "roadmap", "WBS", "Gantt", or "timeline" in the description auto-generates a WBS + Gantt-chart workbook (from an attached workbook via source_file, or from scratch off the description alone).',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description:
                  'PREFERRED: natural-language description of WHAT TO CREATE (e.g. "stationery invoice", "monthly sales report", "school fees collection tracker with student ID, fee type, amount due, amount paid, balance"). The tool auto-generates appropriate content. Use this alone with filename for the simplest call. Describe the artifact itself — never narrate your own actions (do not write "I will now create..." or "Let me generate..."; describe the content, not the act of creating it).',
              },
              filename: {
                type: 'string',
                description:
                  'Output filename (with or without .xlsx). Auto-generated from description if omitted.',
              },
              output_dir: {
                type: 'string',
                description: 'Directory to save the file. Defaults to Desktop.',
              },
              source_file: {
                type: 'string',
                description:
                  'Optional local source file path. For WBS/project-plan requests from .xlsx roadmap workbooks, the tool reads the workbook directly and creates a detailed WBS.',
              },
              sheets: {
                type: 'array',
                description: 'One or more worksheet definitions',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Sheet/tab name' },
                    headers: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Column header labels',
                    },
                    rows: {
                      type: 'array',
                      items: {
                        type: 'array',
                        items: {
                          oneOf: [
                            { type: ['string', 'number', 'boolean', 'null'] },
                            {
                              type: 'object',
                              description:
                                'Live formula cell for financial/statistical calculations, e.g. {"formula":"NPV(0.1,B2:B10)"}, {"formula":"IRR(B2:B10)"}, {"formula":"STDEV(B2:B10)"}, {"formula":"(B10-B2)/B2","numFmt":"0.00%"} for growth rate. formula excludes the leading "=". Cell references use standard Excel A1 notation relative to this sheet.',
                              properties: {
                                formula: { type: 'string' },
                                numFmt: {
                                  type: 'string',
                                  description:
                                    "Optional display format, e.g. '$#,##0.00', '0.00%'.",
                                },
                              },
                              required: ['formula'],
                            },
                          ],
                        },
                      },
                      description:
                        'Data rows — each row is an array of cell values matching headers order. Cells can be plain values or formula objects for calculations.',
                    },
                    column_widths: {
                      type: 'array',
                      items: { type: 'number' },
                      description: 'Optional explicit column widths in characters',
                    },
                    freeze_header: {
                      type: 'boolean',
                      description: 'Freeze the header row (default true)',
                    },
                    add_totals_row: {
                      type: 'boolean',
                      description: 'Add a SUM totals row for numeric columns',
                    },
                    chart: {
                      type: 'object',
                      description:
                        'Optional analytics visual: renders a native Excel data-bar over a numeric column so values are visible at a glance.',
                      properties: {
                        value_column: {
                          type: 'number',
                          description: '0-based index of the numeric column to visualize',
                        },
                      },
                      required: ['value_column'],
                    },
                  },
                  required: ['name', 'headers', 'rows'],
                },
              },
            },
            required: [],
          },
        },
        {
          name: 'create_word_document',
          description:
            'Create a Word (.docx) document with rich formatting: headings, paragraphs, bullet lists, numbered lists, and tables. Use this when the user asks for a Word doc, report, letter, proposal, essay, or any written document.',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description:
                  'PREFERRED: natural-language description of WHAT TO CREATE (e.g. "project proposal", "business report", "meeting agenda"). Auto-generates content. Describe the artifact itself — never narrate your own actions (do not write "I will now create..." or "Let me generate..."; describe the content, not the act of creating it).',
              },
              filename: {
                type: 'string',
                description:
                  'Output filename (with or without .docx). Auto-generated from description if omitted.',
              },
              output_dir: {
                type: 'string',
                description: 'Directory to save the file. Defaults to Desktop.',
              },
              title: {
                type: 'string',
                description: 'Document title (shown as a large title at the top)',
              },
              author: { type: 'string', description: 'Author name for document metadata' },
              blocks: {
                type: 'array',
                description: 'Content blocks in order. Each block has a type and optional heading.',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['paragraph', 'bullet_list', 'numbered_list', 'table', 'page_break'],
                      description: 'Block type',
                    },
                    heading: {
                      type: 'string',
                      description: 'Optional section heading text to show before this block',
                    },
                    heading_level: {
                      type: 'number',
                      enum: [1, 2, 3],
                      description: 'Heading level (1=H1, 2=H2, 3=H3). Default 1.',
                    },
                    text: {
                      type: 'string',
                      description:
                        'For type=paragraph: the paragraph text. Use \\n for line breaks.',
                    },
                    items: {
                      type: 'array',
                      items: {
                        oneOf: [
                          { type: 'string' },
                          { type: 'object', properties: { text: { type: 'string' } } },
                        ],
                      },
                      description:
                        'For bullet_list or numbered_list: array of list item strings (e.g. ["Item one", "Item two"]).',
                    },
                    table: {
                      type: 'object',
                      description: 'For type=table: table definition',
                      properties: {
                        headers: {
                          type: 'array',
                          items: { type: 'string' },
                          description: 'Column header labels',
                        },
                        rows: {
                          type: 'array',
                          items: { type: 'array', items: { type: 'string' } },
                          description: 'Table data rows (array of arrays of strings)',
                        },
                      },
                      required: ['headers', 'rows'],
                    },
                  },
                  description:
                    'type is optional if the block has a heading and items — it defaults to bullet_list.',
                },
              },
            },
            required: [],
          },
        },
        {
          name: 'create_presentation',
          description:
            'Create a PowerPoint (.pptx) presentation with styled slides. Supports title slides, content slides with bullet points, two-column comparison slides, and table slides. Use this when the user asks for a presentation, slides, PPT, or deck.',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description:
                  'PREFERRED: natural-language description of WHAT TO CREATE (e.g. "startup pitch deck", "quarterly sales review", "product training"). Auto-generates slides. Describe the artifact itself — never narrate your own actions (do not write "I will now create..." or "Let me generate..."; describe the content, not the act of creating it).',
              },
              filename: {
                type: 'string',
                description:
                  'Output filename (with or without .pptx). Auto-generated from description if omitted.',
              },
              output_dir: {
                type: 'string',
                description: 'Directory to save the file. Defaults to Desktop.',
              },
              source_file: {
                type: 'string',
                description:
                  'Optional local source file path. When provided for .xlsx roadmap/workbook inputs, the tool reads the workbook directly and creates slides from actual source data.',
              },
              title: {
                type: 'string',
                description: 'Presentation title (shown on auto-generated cover slide)',
              },
              subtitle: { type: 'string', description: 'Subtitle for the cover slide' },
              author: { type: 'string', description: 'Author name for metadata' },
              theme_color: {
                type: 'string',
                description: 'Primary theme color as 6-char hex (default: 1F4E79)',
              },
              slides: {
                type: 'array',
                description: 'Slide definitions in order',
                items: {
                  type: 'object',
                  properties: {
                    layout: {
                      type: 'string',
                      enum: ['title', 'content', 'two_column', 'table', 'chart', 'blank'],
                      description:
                        'title=section title slide, content=bulleted content, two_column=side-by-side, table=data table, chart=native bar/pie/line/doughnut chart, blank=empty canvas',
                    },
                    title: { type: 'string', description: 'Slide title' },
                    subtitle: { type: 'string', description: 'Subtitle (for title layout only)' },
                    bullets: {
                      type: 'array',
                      description:
                        'Bullet points for content layout. Each item is a string or {text, level} where level 0=main, 1=sub.',
                      items: {
                        oneOf: [
                          { type: 'string' },
                          {
                            type: 'object',
                            properties: {
                              text: { type: 'string' },
                              level: { type: 'number', enum: [0, 1, 2] },
                            },
                            required: ['text'],
                          },
                        ],
                      },
                    },
                    left_bullets: {
                      type: 'array',
                      items: {
                        oneOf: [
                          { type: 'string' },
                          {
                            type: 'object',
                            properties: { text: { type: 'string' }, level: { type: 'number' } },
                            required: ['text'],
                          },
                        ],
                      },
                      description: 'Left column bullets for two_column layout',
                    },
                    right_bullets: {
                      type: 'array',
                      items: {
                        oneOf: [
                          { type: 'string' },
                          {
                            type: 'object',
                            properties: { text: { type: 'string' }, level: { type: 'number' } },
                            required: ['text'],
                          },
                        ],
                      },
                      description: 'Right column bullets for two_column layout',
                    },
                    table: {
                      type: 'object',
                      description: 'Table data for table layout',
                      properties: {
                        headers: { type: 'array', items: { type: 'string' } },
                        rows: {
                          type: 'array',
                          items: { type: 'array', items: { type: 'string' } },
                        },
                      },
                      required: ['headers', 'rows'],
                    },
                    chart: {
                      type: 'object',
                      description: 'Chart data for chart layout',
                      properties: {
                        type: { type: 'string', enum: ['bar', 'pie', 'line', 'doughnut'] },
                        categories: { type: 'array', items: { type: 'string' } },
                        series: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              values: { type: 'array', items: { type: 'number' } },
                            },
                            required: ['name', 'values'],
                          },
                        },
                      },
                      required: ['type', 'categories', 'series'],
                    },
                    notes: { type: 'string', description: 'Speaker notes for this slide' },
                  },
                  required: ['layout'],
                },
              },
            },
            required: [],
          },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params as {
      name: string;
      arguments: Record<string, unknown>;
    };

    try {
      switch (name) {
        case 'create_excel': {
          const raw = args as {
            description?: string;
            filename?: string;
            sheets?: ExcelSheetDef[];
            output_dir?: string;
            source_file?: string;
          };
          let params: CreateExcelParams;
          if (!raw.sheets || raw.sheets.length === 0) {
            const desc = raw.description || raw.filename || 'spreadsheet';
            const fname =
              raw.filename || (!looksLikeAssistantEcho(desc) && slugify(desc)) || 'spreadsheet';
            const shouldBuildWbs =
              /\b(wbs|work breakdown|project plan|tasks? and sub[- ]?tasks?|task breakdown|implementation plan|roadmap|gantt|timeline)\b/i.test(
                desc
              );
            const workbookParams = !shouldBuildWbs
              ? null
              : raw.source_file
                ? await generateExcelWbsFromWorkbookSource(raw.source_file, fname).catch(
                    (error) => {
                      process.stderr.write(
                        `[office-tools-server] WBS source generation failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
                      );
                      return null;
                    }
                  )
                : await generateGanttRoadmapFromDescription(desc, fname).catch((error) => {
                    process.stderr.write(
                      `[office-tools-server] Gantt roadmap generation failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
                    );
                    return null;
                  });
            const aiJson = workbookParams ? null : await callOllamaForContent(desc, 'excel');
            if (workbookParams) {
              params = workbookParams;
            } else if (aiJson) {
              try {
                const aiData = JSON.parse(aiJson) as Partial<CreateExcelParams>;
                if (Array.isArray(aiData.sheets) && aiData.sheets.length > 0) {
                  params = { filename: fname, sheets: aiData.sheets };
                } else {
                  params = generateExcelFromDescription(desc, raw.filename);
                }
              } catch {
                params = generateExcelFromDescription(desc, raw.filename);
              }
            } else {
              params = generateExcelFromDescription(desc, raw.filename);
            }
            if (raw.output_dir) params.output_dir = raw.output_dir;
          } else {
            params = raw as unknown as CreateExcelParams;
          }
          const outPath = await createExcel(params);
          return {
            content: [{ type: 'text', text: `✅ Excel file created: ${outPath}` }],
          };
        }

        case 'create_word_document': {
          const raw = args as {
            description?: string;
            filename?: string;
            blocks?: WordBlock[];
            output_dir?: string;
            title?: string;
            author?: string;
          };
          let params: CreateWordParams;
          if (!raw.blocks || raw.blocks.length === 0) {
            const desc = raw.description || raw.title || raw.filename || 'document';
            const fname =
              raw.filename || (!looksLikeAssistantEcho(desc) && slugify(desc)) || 'document';
            const aiJson = await callOllamaForContent(desc, 'word');
            if (aiJson) {
              try {
                const aiData = JSON.parse(aiJson) as Partial<CreateWordParams>;
                if (Array.isArray(aiData.blocks) && aiData.blocks.length > 0) {
                  params = {
                    filename: fname,
                    title: aiData.title,
                    blocks: aiData.blocks,
                    author: raw.author,
                  };
                } else {
                  params = generateWordFromDescription(desc, raw.filename);
                }
              } catch {
                params = generateWordFromDescription(desc, raw.filename);
              }
            } else {
              params = generateWordFromDescription(desc, raw.filename);
            }
            if (raw.output_dir) params.output_dir = raw.output_dir;
            if (raw.author && !params.author) params.author = raw.author;
          } else {
            params = raw as unknown as CreateWordParams;
          }
          const outPath = await createWordDocument(params);
          return {
            content: [{ type: 'text', text: `✅ Word document created: ${outPath}` }],
          };
        }

        case 'create_presentation': {
          const raw = args as {
            description?: string;
            filename?: string;
            slides?: PptSlide[];
            output_dir?: string;
            source_file?: string;
            title?: string;
            subtitle?: string;
            author?: string;
            theme_color?: string;
          };
          let params: CreatePresentationParams;
          if (!raw.slides || raw.slides.length === 0) {
            const desc = raw.description || raw.title || raw.filename || 'presentation';
            const fname =
              raw.filename || (!looksLikeAssistantEcho(desc) && slugify(desc)) || 'presentation';
            const workbookParams = raw.source_file
              ? await generatePresentationFromWorkbookSource(raw.source_file, fname).catch(
                  () => null
                )
              : null;
            const aiJson = workbookParams ? null : await callOllamaForContent(desc, 'ppt');
            if (workbookParams) {
              params = workbookParams;
            } else if (aiJson) {
              try {
                const aiData = JSON.parse(aiJson) as Partial<CreatePresentationParams>;
                if (Array.isArray(aiData.slides) && aiData.slides.length > 0) {
                  params = {
                    filename: fname,
                    title: aiData.title,
                    subtitle: aiData.subtitle ?? raw.subtitle,
                    slides: aiData.slides,
                    author: raw.author,
                    theme_color: raw.theme_color,
                  };
                } else {
                  params = generatePresentationFromDescription(desc, raw.filename);
                }
              } catch {
                params = generatePresentationFromDescription(desc, raw.filename);
              }
            } else {
              params = generatePresentationFromDescription(desc, raw.filename);
            }
            if (raw.output_dir) params.output_dir = raw.output_dir;
            if (raw.author && !params.author) params.author = raw.author;
            if (raw.theme_color && !params.theme_color) params.theme_color = raw.theme_color;
          } else {
            params = raw as unknown as CreatePresentationParams;
          }
          const outPath = await createPresentation(params);
          return {
            content: [{ type: 'text', text: `✅ PowerPoint presentation created: ${outPath}` }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `❌ Error in ${name}: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

serveStdio(() => createMcpServer(), {
  onerror: (error: Error) => {
    process.stderr.write(`[office-tools-server] Fatal: ${error}\n`);
  },
});
