/**
 * OCR Tools MCP Server for V-Coworker
 *
 * Extracts text from images and scanned documents using Tesseract OCR
 * (via the tesseract.js library — pure JS/WASM, runs fully locally, no API key).
 */

// Bootstrap logging - log as early as possible
import { writeMCPLog } from './mcp-logger.js';
import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

writeMCPLog('=== Module Loading Started ===', 'Bootstrap');

import * as path from 'path';
import * as fs from 'fs/promises';
import { createWorker, type Worker } from 'tesseract.js';
writeMCPLog('Imported dependencies', 'Bootstrap');

declare const require: NodeJS.Require;

// tesseract.js resolves its worker/core assets relative to its own package
// location by default. Once this server is esbuild-bundled into a single
// file, that default resolution breaks (the bundle's __dirname no longer
// matches tesseract.js's real install location), so the worker thread fails
// to load with MODULE_NOT_FOUND. Resolve the real on-disk paths explicitly
// via require.resolve, which uses Node's actual module resolution against
// this file's real location — that keeps working after bundling.
function resolveTesseractAssetPaths(): { corePath: string; workerPath: string } {
  const tesseractRoot = path.dirname(require.resolve('tesseract.js/package.json'));
  const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
  return {
    // The Node worker script — NOT dist/worker.min.js, which is the browser bundle
    // and expects a browser-like global (addEventListener) that doesn't exist in Node.
    workerPath: path.join(tesseractRoot, 'src', 'worker-script', 'node', 'index.js'),
    corePath: coreRoot,
  };
}

const SUPPORTED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
  '.pdf',
]);

// Tesseract workers are expensive to spin up (loads the language model). Reuse
// one worker per language across calls in this process instead of recreating
// it every time, and lazily swap it out only when the requested language changes.
let cachedWorker: Worker | null = null;
let cachedWorkerLanguage: string | null = null;

async function getWorker(language: string): Promise<Worker> {
  if (cachedWorker && cachedWorkerLanguage === language) {
    return cachedWorker;
  }
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
    cachedWorkerLanguage = null;
  }
  writeMCPLog(`Initializing Tesseract worker for language: ${language}`, 'OCR Init');
  const { workerPath, corePath } = resolveTesseractAssetPaths();
  const worker = await createWorker(language, undefined, { workerPath, corePath });
  cachedWorker = worker;
  cachedWorkerLanguage = language;
  return worker;
}

async function resolveInputPath(imagePath: string): Promise<string> {
  const resolved = path.resolve(imagePath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type "${ext}". Supported: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}`
    );
  }
  return resolved;
}

async function extractText(
  imagePath: string,
  language: string
): Promise<{ text: string; confidence: number }> {
  const resolved = await resolveInputPath(imagePath);
  const worker = await getWorker(language);
  writeMCPLog(`Running OCR on: ${resolved}`, 'OCR Extract');
  const {
    data: { text, confidence },
  } = await worker.recognize(resolved);
  return { text: text.trim(), confidence };
}

function createMcpServer() {
  const server = new Server(
    { name: 'ocr-tools-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'ocr_extract_text',
          description:
            'Extract text from an image or scanned document (PNG, JPG, GIF, BMP, WEBP, TIFF, PDF) using local OCR. ' +
            'Use this for scanned invoices, receipts, screenshots of text, photographed documents, or any image ' +
            'containing text that needs to be read. Runs fully offline after the language model is first downloaded. ' +
            'Not needed for born-digital PDFs/documents that already contain selectable text — read those directly instead.',
          inputSchema: {
            type: 'object',
            properties: {
              image_path: {
                type: 'string',
                description: 'Absolute path to the local image or PDF file to OCR.',
              },
              language: {
                type: 'string',
                description:
                  'Tesseract language code, e.g. "eng" (English, default), "hin" (Hindi), "eng+hin" (multiple languages combined).',
              },
            },
            required: ['image_path'],
          },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      writeMCPLog(`[CallTool] name=${name}, args=${JSON.stringify(args ?? {})}`, 'Tool Call');

      if (name !== 'ocr_extract_text') {
        throw new Error(`Unknown tool: ${name}`);
      }

      const { image_path, language = 'eng' } = args as {
        image_path: string;
        language?: string;
      };
      if (!image_path || typeof image_path !== 'string') {
        throw new Error('image_path is required');
      }

      const { text, confidence } = await extractText(image_path, language);

      return {
        content: [
          {
            type: 'text',
            text: text
              ? `${text}\n\n(OCR confidence: ${confidence.toFixed(1)}%)`
              : `(No text detected — OCR confidence: ${confidence.toFixed(1)}%)`,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeMCPLog(`[CallTool] Error in ${name}: ${msg}`, 'Tool Call Error');
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
    process.stderr.write(`[ocr-tools-server] Fatal: ${error}\n`);
  },
});
