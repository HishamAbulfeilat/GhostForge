import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname, basename } from 'path';
import { exec } from 'child_process';

/**
 * File processor module for GhostForge JARVIS.
 * Reads, summarises, extracts text from, and converts files.
 */

/** Supported file extensions for text extraction. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.html', '.css', '.yaml', '.yml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.sql', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.swift', '.kt', '.php', '.r',
]);

const BINARY_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);

export interface FileExtractionResult {
  /** Extracted plain text content */
  content: string;
  /** File type detected */
  type: string;
  /** Number of characters extracted */
  charCount: number;
}

export interface FileSummaryResult {
  /** LLM-generated summary */
  summary: string;
  /** Original file path */
  path: string;
  /** File type */
  type: string;
  /** Character count of original content */
  charCount: number;
}

function runShell(cmd: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

function detectFileType(filePath: string): string {
  return extname(filePath).toLowerCase();
}

/** Extract text from a file based on its extension. */
export async function extractText(filePath: string): Promise<FileExtractionResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = detectFileType(filePath);
  let content = '';
  let type = 'text';

  if (TEXT_EXTENSIONS.has(ext)) {
    type = 'text';
    content = readFileSync(filePath, 'utf-8');
  } else if (ext === '.pdf') {
    type = 'pdf';
    content = await extractPdf(filePath);
  } else if (ext === '.docx') {
    type = 'docx';
    content = await extractDocx(filePath);
  } else if (ext === '.xlsx') {
    type = 'xlsx';
    content = await extractXlsx(filePath);
  } else {
    // Try reading as text
    type = 'unknown';
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  return {
    content,
    type,
    charCount: content.length,
  };
}

/** Extract text from a PDF file using pdf-parse. */
async function extractPdf(filePath: string): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch {
    // Fallback: use pdftotext if available (poppler-utils)
    try {
      return await runShell(`pdftotext "${filePath}" - 2>/dev/null`);
    } catch {
      throw new Error('Cannot extract PDF text. Install pdf-parse: npm i pdf-parse');
    }
  }
}

/** Extract text from a DOCX file using mammoth. */
async function extractDocx(filePath: string): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const buffer = readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch {
    // Fallback: use pandoc if available
    try {
      return await runShell(`pandoc "${filePath}" -t plain 2>/dev/null`);
    } catch {
      throw new Error('Cannot extract DOCX text. Install mammoth: npm i mammoth');
    }
  }
}

/** Extract text from an XLSX file. Reads CSV-like output. */
async function extractXlsx(filePath: string): Promise<string> {
  try {
    // Try xlsx library
    const XLSX = await import('xlsx');
    const workbook = XLSX.readFile(filePath);
    const allText: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        allText.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      }
    }

    return allText.join('\n\n') || '(empty workbook)';
  } catch {
    // Fallback: python
    try {
      return await runShell(
        `python3 -c "
import openpyxl
wb = openpyxl.load_workbook('${filePath}')
for name in wb.sheetnames:
    print(f'--- Sheet: {name} ---')
    for row in wb[name].values:
        print('\\t'.join(str(c) if c is not None else '' for c in row))
" 2>/dev/null`,
      );
    } catch {
      throw new Error('Cannot extract XLSX text. Install xlsx: npm i xlsx');
    }
  }
}

/** Read a file and send its content to an LLM for summarization. */
export async function readAndSummarize(
  filePath: string,
  llmEndpoint?: string,
): Promise<FileSummaryResult> {
  const extracted = await extractText(filePath);

  // Truncate very large files to avoid overwhelming the LLM
  const truncated = extracted.content.slice(0, 30000);

  let summary: string;
  if (llmEndpoint) {
    try {
      const res = await fetch(llmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Summarize the following file (${basename(filePath)}):\n\n${truncated}`,
          maxTokens: 500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as { text?: string; summary?: string };
      summary = data.text || data.summary || 'No summary generated';
    } catch {
      summary = generateBasicSummary(truncated, basename(filePath));
    }
  } else {
    summary = generateBasicSummary(truncated, basename(filePath));
  }

  return {
    summary,
    path: filePath,
    type: extracted.type,
    charCount: extracted.charCount,
  };
}

/** Ask a question about a file using an LLM. */
export async function askQuestionAboutFile(
  filePath: string,
  question: string,
  llmEndpoint?: string,
): Promise<string> {
  const extracted = await extractText(filePath);
  const truncated = extracted.content.slice(0, 25000);

  if (llmEndpoint) {
    try {
      const res = await fetch(llmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Based on the following file (${basename(filePath)}), answer this question:\n\nQuestion: ${question}\n\nFile content:\n${truncated}`,
          maxTokens: 1000,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as { text?: string; answer?: string };
      return data.text || data.answer || 'Could not generate answer';
    } catch {
      return `Cannot reach LLM endpoint. File contains ${extracted.charCount} characters of ${extracted.type} content.`;
    }
  }

  return `File: ${basename(filePath)} (${extracted.type}, ${extracted.charCount} chars)\nQuestion: ${question}\n\nNo LLM endpoint configured. Content preview:\n${truncated.slice(0, 500)}`;
}

/** Basic summary generation without an LLM. */
function generateBasicSummary(content: string, filename: string): string {
  const lines = content.split('\n').filter(l => l.trim());
  const wordCount = content.split(/\s+/).length;
  const charCount = content.length;

  const header = lines.find(l => l.startsWith('#'));
  const firstLines = lines.slice(0, 5).map(l => l.trim()).join(' ');

  return `File: ${filename}\n` +
    `Size: ${wordCount} words, ${charCount} characters, ${lines.length} lines\n` +
    (header ? `Title: ${header}\n` : '') +
    `Preview: ${firstLines.slice(0, 300)}`;
}

/** Convert a file between supported formats. */
export async function convertFormat(
  inputPath: string,
  outputFormat: 'txt' | 'md' | 'json' | 'csv' | 'html',
): Promise<string> {
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const extracted = await extractText(inputPath);
  const baseName = basename(inputPath, detectFileType(inputPath));
  const outputPath = inputPath.replace(detectFileType(inputPath), `.${outputFormat}`);

  switch (outputFormat) {
    case 'txt':
    case 'md':
      writeFileSync(outputPath, extracted.content, 'utf-8');
      break;

    case 'json': {
      const jsonData = {
        source: inputPath,
        type: extracted.type,
        charCount: extracted.charCount,
        content: extracted.content,
      };
      writeFileSync(outputPath, JSON.stringify(jsonData, null, 2), 'utf-8');
      break;
    }

    case 'csv': {
      // Convert lines to CSV-friendly format
      const rows = extracted.content.split('\n').filter(l => l.trim());
      const csvContent = rows.map(line => {
        const cells = line.split(/[,\t]/).map(c => c.trim());
        return cells.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
      }).join('\n');
      writeFileSync(outputPath, csvContent, 'utf-8');
      break;
    }

    case 'html': {
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${baseName}</title>
  <style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}</style>
</head>
<body>
<pre>${escapeHtml(extracted.content)}</pre>
</body>
</html>`;
      writeFileSync(outputPath, htmlContent, 'utf-8');
      break;
    }

    default:
      throw new Error(`Unsupported output format: ${outputFormat}`);
  }

  return outputPath;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
