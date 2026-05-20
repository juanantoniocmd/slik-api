import { Elysia, t } from 'elysia';
import { parseSlikPdf } from '../parsers/pdf-parser';
import { scoreSlikReport } from '../scoring/adira-model';
import { join } from 'path';
import { mkdir } from 'fs/promises';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

// Ensure uploads directory exists
await mkdir(UPLOADS_DIR, { recursive: true });

export const slikRoutes = new Elysia({ prefix: '/api/slik' })
  .post('/upload', async ({ body: { file }, set }) => {
    try {
      // Create a unique filename
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const filename = `slik_${timestamp}_${randomStr}.pdf`;
      const filePath = join(UPLOADS_DIR, filename);

      // Save the file locally using Bun.write
      await Bun.write(filePath, file);
      console.log(`[SLIK] Saved ${filename} (${file.size} bytes). Parsing...`);

      // Run pdfexcavator parsing engine → returns ParsedSLIK
      const parsedResult = await parseSlikPdf(filePath);

      // Run Adira v4.1 Credit Scoring
      const scoring = scoreSlikReport(parsedResult);

      const debtor = parsedResult.debitur_pokok[0];
      console.log(`[SLIK] Parsed: ${debtor?.nama ?? 'Unknown'} (NIK: ${debtor?.nik ?? '-'}), ${parsedResult.facilities.length} fasilitas`);
      console.log(`[SLIK] Score: ${scoring.stage3_scoring.score} | Grade: ${scoring.stage3_scoring.grade} | Decision: ${scoring.stage3_scoring.decision}`);
      if (parsedResult.parse_warnings.length) {
        console.warn(`[SLIK] Warnings:`, parsedResult.parse_warnings);
      }

      return {
        success: true,
        message: 'File SLIK berhasil diunggah dan diproses',
        filename,
        data: parsedResult,
        scoring,
      };

    } catch (error: any) {
      console.error('[SLIK] Error processing PDF:', error);
      set.status = 500;
      return {
        success: false,
        message: 'Gagal memproses file SLIK',
        error: error.message || String(error),
      };
    }
  }, {
    body: t.Object({
      file: t.File({
        type: 'application/pdf',
        error: 'File harus berformat PDF (application/pdf)',
      }),
    }),
    detail: {
      summary: 'Upload & Score SLIK OJK PDF',
      description: 'Upload file PDF SLIK OJK iDeb, parse semua field, jalankan Adira v4.1 Credit Scoring (4 tahap), dan return hasil scoring, grade, keputusan, serta flag diagnostik.',
      tags: ['SLIK OJK'],
    },
  });
