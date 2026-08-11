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
              filename: { type: 'string', description: 'Output filename (with or without .xlsx)' },
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
            required: ['filename', 'sheets'],
          },
        },
        {
          name: 'create_word_document',
          description:
            'Create a Word (.docx) document with rich formatting: headings, paragraphs, bullet lists, numbered lists, and tables. Use this when the user asks for a Word doc, report, letter, proposal, essay, or any written document.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Output filename (with or without .docx)' },
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
            required: ['filename', 'blocks'],
          },
        },
        {
          name: 'create_presentation',
          description:
            'Create a PowerPoint (.pptx) presentation with styled slides. Supports title slides, content slides with bullet points, two-column comparison slides, and table slides. Use this when the user asks for a presentation, slides, PPT, or deck.',
          inputSchema: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Output filename (with or without .pptx)' },
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
            required: ['filename', 'slides'],
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
          const outPath = await createExcel(args as unknown as CreateExcelParams);
          return {
            content: [{ type: 'text', text: `✅ Excel file created: ${outPath}` }],
          };
        }

        case 'create_word_document': {
          const outPath = await createWordDocument(args as unknown as CreateWordParams);
          return {
            content: [{ type: 'text', text: `✅ Word document created: ${outPath}` }],
          };
        }

        case 'create_presentation': {
          const outPath = await createPresentation(args as unknown as CreatePresentationParams);
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
