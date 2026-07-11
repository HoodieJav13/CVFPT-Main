async function extractPdfText(buffer) {
  // Keep the native PDF/canvas stack out of application startup. Serverless
  // health and non-PDF routes should not depend on native parser initialization.
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result.text || '');
  } finally {
    await parser.destroy();
  }
}

module.exports = { extractPdfText };
