/**
 * Office Tools MCP Server for dsr-CoworkAI
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

interface ExcelSheetDef {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  column_widths?: number[];
  freeze_header?: boolean;
  add_totals_row?: boolean;
}

interface CreateExcelParams {
  filename: string;
  output_dir?: string;
  sheets: ExcelSheetDef[];
}

async function createExcel(params: CreateExcelParams): Promise<string> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.default.Workbook();
  wb.creator = 'dsr-CoworkAI';
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
      const dataRow = ws.addRow(row);
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        // Zebra striping
        const rowIdx = dataRow.number;
        if (rowIdx % 2 === 0) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCE6F1' },
          };
        }
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFB8CCE4' } },
        };
        // Auto-align numbers right
        if (typeof row[colNum - 1] === 'number') {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = Number.isInteger(row[colNum - 1]) ? '#,##0' : '#,##0.00';
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
          ...(sheetDef.rows || []).map((r) => String(r[i] ?? '').length)
        );
        ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 12), 40);
      });
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
    /stationar|office supply|pen|pencil|paper|notebook|folder|binder|marker|eraser/.test(d);
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
  const d = description.toLowerCase();
  const fname = filename || slugify(description) || 'presentation';
  const isPitch = /pitch|startup|investor|funding/.test(d);
  const isReport = /report|quarterly|annual|review/.test(d);
  const isTraining = /training|course|tutorial|workshop/.test(d);

  const title = description.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);

  if (isPitch) {
    return {
      filename: fname,
      title,
      subtitle: 'Investor Pitch Deck',
      slides: [
        {
          layout: 'content',
          title: 'The Problem',
          bullets: [
            'Current market gap or pain point',
            'Who is affected and how significantly',
            'Why existing solutions fall short',
          ],
        },
        {
          layout: 'content',
          title: 'Our Solution',
          bullets: [
            'Clear description of the product or service',
            'How it solves the problem',
            'Key differentiators from competitors',
          ],
        },
        {
          layout: 'two_column',
          title: 'Market Opportunity',
          left_bullets: [
            'Total Addressable Market: $X billion',
            'Serviceable Market: $Y million',
            '5-year CAGR: Z%',
          ],
          right_bullets: ['Target customer segment', 'Geographic focus', 'Entry strategy'],
        },
        {
          layout: 'content',
          title: 'Business Model',
          bullets: [
            'Revenue streams (subscription / transaction / licensing)',
            'Pricing strategy',
            'Unit economics and margins',
          ],
          notes: 'Explain how the business makes money.',
        },
        {
          layout: 'table',
          title: 'Traction & Milestones',
          table: {
            headers: ['Milestone', 'Status', 'Date'],
            rows: [
              ['MVP Launched', 'Completed', 'Q1 2025'],
              ['First 100 Customers', 'Completed', 'Q2 2025'],
              ['Series A Raise', 'In Progress', 'Q3 2025'],
              ['Break-even', 'Planned', 'Q4 2025'],
            ],
          },
        },
        {
          layout: 'content',
          title: 'The Ask',
          bullets: [
            'Funding amount: $X million',
            'Use of funds: 50% product, 30% sales, 20% operations',
            'Expected runway: 18–24 months',
          ],
          notes: 'Be specific about what you need and why.',
        },
      ],
    };
  }

  if (isReport) {
    return {
      filename: fname,
      title,
      subtitle: 'Quarterly Business Review',
      slides: [
        {
          layout: 'content',
          title: 'Quarter at a Glance',
          bullets: [
            'Revenue: $X (↑12% vs prior quarter)',
            'Operating profit: $Y (↑8%)',
            'Customer base: Z (↑15% new customers)',
            'Key highlight: [Major achievement]',
          ],
        },
        {
          layout: 'table',
          title: 'KPI Scorecard',
          table: {
            headers: ['KPI', 'Target', 'Actual', 'Status'],
            rows: [
              ['Revenue', '$500K', '$562K', '✅ Exceeded'],
              ['Gross Margin', '60%', '63%', '✅ Exceeded'],
              ['Customer Churn', '<5%', '3.2%', '✅ Exceeded'],
              ['NPS Score', '>70', '74', '✅ Exceeded'],
            ],
          },
        },
        {
          layout: 'content',
          title: 'Wins & Highlights',
          bullets: [
            '[Key win 1 — specific achievement]',
            '[Key win 2 — specific achievement]',
            '[Key win 3 — specific achievement]',
            'Team grew by X members',
          ],
          notes: 'Celebrate the wins before discussing challenges.',
        },
        {
          layout: 'content',
          title: 'Challenges & Learnings',
          bullets: [
            '[Challenge 1] — Mitigation: [action taken]',
            '[Challenge 2] — Mitigation: [action taken]',
            '[Learning] — Applied in [area]',
          ],
        },
        {
          layout: 'content',
          title: 'Next Quarter Priorities',
          bullets: [
            'Priority 1: [Goal and measurable outcome]',
            'Priority 2: [Goal and measurable outcome]',
            'Priority 3: [Goal and measurable outcome]',
            'Resource requirements: [Summary]',
          ],
        },
      ],
    };
  }

  if (isTraining) {
    return {
      filename: fname,
      title,
      subtitle: 'Training Programme',
      slides: [
        {
          layout: 'content',
          title: 'Learning Objectives',
          bullets: [
            'By the end of this session, you will be able to:',
            'Objective 1: [Skill or knowledge outcome]',
            'Objective 2: [Skill or knowledge outcome]',
            'Objective 3: [Skill or knowledge outcome]',
          ],
        },
        {
          layout: 'content',
          title: 'Module 1: Foundations',
          bullets: ['Key concept 1', 'Key concept 2', 'Key concept 3'],
          notes: 'Spend 15 minutes on this section.',
        },
        {
          layout: 'content',
          title: 'Module 2: Core Skills',
          bullets: [
            'Skill 1 — theory and practice',
            'Skill 2 — worked examples',
            'Skill 3 — hands-on exercise',
          ],
        },
        {
          layout: 'content',
          title: 'Module 3: Advanced Topics',
          bullets: ['Advanced concept 1', 'Advanced concept 2', 'Case study / real-world example'],
        },
        {
          layout: 'content',
          title: 'Summary & Next Steps',
          bullets: [
            'Recap of key learnings',
            'Resources for further reading',
            'Assessment or quiz',
            'Contact details for support',
          ],
        },
      ],
    };
  }

  // Default general presentation
  return {
    filename: fname,
    title,
    subtitle: 'Presentation',
    slides: [
      {
        layout: 'content',
        title: 'Overview',
        bullets: [
          'Background and context',
          'Purpose of this presentation',
          'Key topics covered today',
        ],
      },
      {
        layout: 'content',
        title: 'Section 1',
        bullets: ['Main point 1', 'Supporting detail', 'Example or evidence'],
      },
      {
        layout: 'content',
        title: 'Section 2',
        bullets: ['Main point 2', 'Supporting detail', 'Example or evidence'],
      },
      {
        layout: 'two_column',
        title: 'Comparison',
        left_bullets: ['Option A benefits', 'Cost: Lower', 'Timeline: Faster'],
        right_bullets: ['Option B benefits', 'Cost: Higher', 'Quality: Better'],
      },
      {
        layout: 'content',
        title: 'Conclusions & Next Steps',
        bullets: [
          'Key takeaway 1',
          'Key takeaway 2',
          'Recommended next action',
          'Timeline and ownership',
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
  type: 'paragraph' | 'bullet_list' | 'numbered_list' | 'table' | 'page_break';
  heading?: string;
  heading_level?: 1 | 2 | 3;
  text?: string;
  items?: string[];
  table?: WordTableDef;
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
    BorderStyle,
    AlignmentType,
    UnderlineType,
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

    switch (block.type) {
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
        for (const item of block.items || []) {
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
        for (let i = 0; i < (block.items || []).length; i++) {
          children.push(
            new Paragraph({
              text: `${i + 1}. ${block.items![i]}`,
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
    creator: params.author || 'dsr-CoworkAI',
    title: params.title || 'Document',
    description: `Created by dsr-CoworkAI`,
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

interface PptSlide {
  layout: 'title' | 'content' | 'two_column' | 'table' | 'blank';
  title?: string;
  subtitle?: string;
  bullets?: (string | PptBullet)[];
  left_bullets?: (string | PptBullet)[];
  right_bullets?: (string | PptBullet)[];
  table?: PptTableDef;
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

async function createPresentation(params: CreatePresentationParams): Promise<string> {
  const pptxgen = await import('pptxgenjs');
  const prs = new pptxgen.default();

  const THEME = params.theme_color || '1F4E79';
  const THEME_LIGHT = 'D6E4F0';
  const ACCENT = '2E74B5';

  prs.author = params.author || 'dsr-CoworkAI';
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
          text: params.title || 'dsr-CoworkAI',
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
    titleSlide.addText('dsr-CoworkAI', {
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
              options: { bold: true, color: 'FFFFFF', fill: THEME, align: 'center' as const },
            })),
            ...rows.map((row, ri) =>
              row.map((cell) => ({
                text: cell,
                options: { fill: ri % 2 === 0 ? THEME_LIGHT : 'FFFFFF', fontSize: 14 },
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
            'Create an Excel (.xlsx) spreadsheet with one or more sheets. Supports styled headers, data rows, auto-totals, column widths, and frozen header rows. Use this whenever the user asks for a spreadsheet, table of data, report, tracker, or anything in Excel format.',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description:
                  'PREFERRED: natural-language description of what to create (e.g. "stationery invoice", "monthly sales report"). The tool auto-generates appropriate content. Use this alone with filename for the simplest call.',
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
                        items: { type: ['string', 'number', 'boolean', 'null'] },
                      },
                      description:
                        'Data rows — each row is an array of cell values matching headers order',
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
                  'PREFERRED: natural-language description of what to create (e.g. "project proposal", "business report", "meeting agenda"). Auto-generates content.',
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
                      items: { type: 'string' },
                      description: 'For bullet_list or numbered_list: array of list item strings',
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
                  required: ['type'],
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
                  'PREFERRED: natural-language description (e.g. "startup pitch deck", "quarterly sales review", "product training"). Auto-generates slides.',
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
                      enum: ['title', 'content', 'two_column', 'table', 'blank'],
                      description:
                        'title=section title slide, content=bulleted content, two_column=side-by-side, table=data table, blank=empty canvas',
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
        case 'create_canva_design': {
          const outPath = await createCanvaDesign(args as unknown as CreateCanvaParams);
          return {
            content: [{ type: 'text', text: `✅ Canva design created: ${outPath}` }],
          };
        }

        case 'create_excel': {
          const raw = args as {
            description?: string;
            filename?: string;
            sheets?: ExcelSheetDef[];
            output_dir?: string;
          };
          let params: CreateExcelParams;
          if (!raw.sheets || raw.sheets.length === 0) {
            const desc = raw.description || raw.filename || 'spreadsheet';
            params = generateExcelFromDescription(desc, raw.filename);
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
            params = generateWordFromDescription(desc, raw.filename);
            if (raw.output_dir) params.output_dir = raw.output_dir;
            if (raw.author) params.author = raw.author;
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
            title?: string;
            subtitle?: string;
            author?: string;
            theme_color?: string;
          };
          let params: CreatePresentationParams;
          if (!raw.slides || raw.slides.length === 0) {
            const desc = raw.description || raw.title || raw.filename || 'presentation';
            params = generatePresentationFromDescription(desc, raw.filename);
            if (raw.output_dir) params.output_dir = raw.output_dir;
            if (raw.author) params.author = raw.author;
            if (raw.theme_color) params.theme_color = raw.theme_color;
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
  onError: (error) => {
    process.stderr.write(`[office-tools-server] Fatal: ${error}\n`);
  },
});
