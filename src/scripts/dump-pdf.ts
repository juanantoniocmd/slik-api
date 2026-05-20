import { open } from 'pdfexcavator';
import { join } from 'path';

async function main() {
  const filePath = join(process.cwd(), 'uploads', 'slik_1779293026549_5qv2lu.pdf');
  let pdf;
  try {
    pdf = await open(filePath);
    console.log(`Extracting text from ${pdf.pages.length} pages...`);
    let fullText = '';
    for (let i = 0; i < pdf.pages.length; i++) {
      const pageText = await pdf.pages[i].extractText();
      fullText += `\n--- PAGE ${i + 1} ---\n`;
      fullText += pageText;
    }
    console.log(fullText);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (pdf) {
      await pdf.close();
    }
  }
}

main();
