jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('../src/components/PdfHost', () => ({ extractPdfText: jest.fn() }));

import JSZip from 'jszip';
import { docxText, pptxText, xlsxText } from '../src/lib/docs/extract';

async function zip(files: Record<string, string>) {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: 'uint8array' });
}

describe('Word (.docx)', () => {
  it('extracts paragraphs, tabs, line breaks, tables and entities', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>Q3 Results &amp; Outlook</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Revenue: </w:t></w:r><w:r><w:t>$4.2M</w:t></w:r><w:r><w:tab/><w:t>up 12%</w:t></w:r></w:p>
      <w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const text = await docxText(await zip({ 'word/document.xml': xml }));
    expect(text).toContain('Q3 Results & Outlook');
    expect(text).toContain('Revenue: $4.2M\tup 12%');
    expect(text).toContain('Line one\nLine two');
    expect(text).toMatch(/Region[\s\S]*Sales/);
  });

  it('rejects damaged files', async () => {
    await expect(docxText(await zip({ 'other.xml': '<x/>' }))).rejects.toThrow('damaged');
  });
});

describe('PowerPoint (.pptx)', () => {
  it('extracts slides in numeric order', async () => {
    const slide = (t: string) => `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const text = await pptxText(
      await zip({ 'ppt/slides/slide10.xml': slide('Ten'), 'ppt/slides/slide2.xml': slide('Two'), 'ppt/slides/slide1.xml': slide('One') }),
    );
    expect(text.indexOf('One')).toBeLessThan(text.indexOf('Two'));
    expect(text.indexOf('Two')).toBeLessThan(text.indexOf('Ten'));
    expect(text).toContain('Slide 1:\nOne');
  });
});

describe('Excel (.xlsx)', () => {
  it('resolves shared strings, inline strings and numbers', async () => {
    const shared = `<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North &amp; East</t></si></sst>`;
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250000</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>South</t></is></c><c r="B3"><v>980000</v></c></row>
      <row r="4"><c r="A4"/></row>
    </sheetData></worksheet>`;
    const text = await xlsxText(await zip({ 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': sheet }));
    expect(text).toBe('Sheet 1:\nRegion | Revenue\nNorth & East | 1250000\nSouth | 980000');
  });
});
