import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import JSZip from 'jszip';
import { extractPdfText } from '../../components/PdfHost';
import { bytesToBase64 } from '../encoding';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type ExtractedDoc = { name: string; kind: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text'; text: string };

const TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
];

export async function pickAndExtract(onProgress?: (msg: string) => void): Promise<ExtractedDoc | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: TYPES, multiple: false, copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (asset.size && asset.size > MAX_FILE_BYTES) throw new Error('This file is larger than 25 MB.');
  const name = asset.name || 'Document';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const file = new File(asset.uri);
  try {
    let doc: ExtractedDoc;
    if (ext === 'pdf' || asset.mimeType === 'application/pdf') {
      onProgress?.('Reading PDF…');
      const bytes = await file.bytes();
      const text = await extractPdfText(bytesToBase64(bytes), (p, t) => onProgress?.(`Reading PDF page ${p} of ${t}…`));
      doc = { name, kind: 'pdf', text };
    } else if (ext === 'docx') {
      onProgress?.('Reading Word document…');
      doc = { name, kind: 'docx', text: await docxText(await file.bytes()) };
    } else if (ext === 'pptx') {
      onProgress?.('Reading slides…');
      doc = { name, kind: 'pptx', text: await pptxText(await file.bytes()) };
    } else if (ext === 'xlsx') {
      onProgress?.('Reading spreadsheet…');
      doc = { name, kind: 'xlsx', text: await xlsxText(await file.bytes()) };
    } else if (['txt', 'md', 'csv', 'text'].includes(ext) || asset.mimeType?.startsWith('text/')) {
      doc = { name, kind: 'text', text: await file.text() };
    } else if (ext === 'doc' || ext === 'ppt' || ext === 'xls') {
      throw new Error('Old Office formats (.doc/.ppt/.xls) are not supported. Save the file as .docx/.pptx/.xlsx or PDF.');
    } else {
      throw new Error('Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx) or text.');
    }
    doc.text = doc.text.replace(/\u0000/g, '').trim();
    if (doc.text.length < 20) {
      throw new Error(
        doc.kind === 'pdf'
          ? 'No text found in this PDF. It may be a scanned image — paste the text instead.'
          : 'No readable text found in this file.',
      );
    }
    return doc;
  } finally {
    try {
      if (file.exists) file.delete(); // the picker's cache copy
    } catch {}
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

export async function docxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This Word file looks damaged.');
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  );
}

export async function pptxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const [i, f] of slides.entries()) {
    const xml = await zip.file(f)!.async('string');
    const text = decodeXml(xml.replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).trim();
    if (text) out.push(`Slide ${i + 1}:\n${text}`);
  }
  return out.join('\n\n');
}

export async function xlsxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml(m[1].replace(/<[^>]+>/g, '')));
  const sheets = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const [i, f] of sheets.entries()) {
    const xml = await zip.file(f)!.async('string');
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) cells.push(shared[Number(v)] ?? '');
        else if (inline !== undefined) cells.push(decodeXml(inline));
        else cells.push(v !== undefined ? decodeXml(v) : '');
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join(' | '));
      if (rows.length >= 400) break; // keep spreadsheets to a summarizable size
    }
    if (rows.length) out.push(`Sheet ${i + 1}:\n${rows.join('\n')}`);
  }
  return out.join('\n\n');
}
