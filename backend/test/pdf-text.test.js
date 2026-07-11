const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { extractPdfText } = require('../src/lib/pdfText');

function createPdf(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text(text);
    doc.end();
  });
}

test('server PDF parser extracts text using the pdf-parse v2 API', async () => {
  const pdf = await createPdf('CVF PDF parser regression');
  const text = await extractPdfText(pdf);
  assert.match(text, /CVF PDF parser regression/);
});
