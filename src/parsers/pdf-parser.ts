import { open } from 'pdfexcavator';
import type {
  ParsedSLIK,
  SLIKFacility,
  SLIKRingkasanFasilitas,
  SLIKDebiturPokok,
  SLIKAgunan,
} from './types';

// =============================================
// HELPER FUNCTIONS
// =============================================

function parseIndonesianDate(raw: string | null): Date | null {
  if (!raw) return null;
  const months: Record<string, number> = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agustus: 7,
    aug: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oktober: 9,
    oct: 9,
    nov: 10,
    november: 10,
    des: 11,
    desember: 11,
    dec: 11,
  };

  // Try matching "15 Mei 2026"
  let match = raw.toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2];
    const year = parseInt(match[3], 10);
    const month =
      months[monthStr] !== undefined
        ? months[monthStr]
        : Object.keys(months).find((k) => monthStr.startsWith(k))
          ? months[Object.keys(months).find((k) => monthStr.startsWith(k))!]
          : undefined;
    if (month !== undefined) return new Date(year, month, day);
  }

  // Try matching "2026-05-15" or "15-05-2026"
  match = raw.match(/(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (match) {
    return new Date(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10),
    );
  }

  match = raw.match(/(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})/);
  if (match) {
    return new Date(
      parseInt(match[3], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[1], 10),
    );
  }

  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseFormattedNumber(val: string | undefined | null): number {
  if (!val) return 0;
  const clean = val
    .replace(/\s/g, '')
    .replace(/[\.\s]/g, '')
    .replace(/,/g, '.');
  if (clean === '-' || clean.toLowerCase() === 'nihil' || clean.trim() === '') {
    return 0;
  }
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

function extractRegex(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  if (!m) return null;
  if (typeof m[1] === 'undefined' || m[1] === null) return null;
  return typeof m[1] === 'string' ? m[1].trim() : null;
}

function extractDateAroundLabel(
  page: string,
  labelPattern: RegExp,
): Date | null {
  const datePattern =
    '(\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}|\\d{4}[./\\-]\\d{1,2}[./\\-]\\d{1,2}|\\d{1,2}[./\\-]\\d{1,2}[./\\-]\\d{2,4})';

  // Prioritas: tanggal muncul setelah label (format yang paling umum di SLIK OCR).
  const afterLabel = page.match(
    new RegExp(`${labelPattern.source}[\\s:./\\-]{0,25}${datePattern}`, 'i'),
  );
  if (afterLabel?.[1]) {
    return parseIndonesianDate(afterLabel[1]);
  }

  // Fallback: tanggal muncul sebelum label (kadang urutan token OCR terbalik).
  const beforeLabel = page.match(
    new RegExp(`${datePattern}[\\s:./\\-]{0,25}${labelPattern.source}`, 'i'),
  );
  if (beforeLabel?.[1]) {
    return parseIndonesianDate(beforeLabel[1]);
  }

  return null;
}

function normalizeText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanToken(raw: string | null | undefined, maxLen = 120): string {
  if (!raw) return '';
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
}

function normalizePelaporName(raw: string): string {
  let value = cleanToken(raw, 120)
    .replace(/^\d{3,6}\s*-\s*/i, '')
    .replace(/^(?:KC|KCP|KK|KP|KCU|KCS|Kantor(?:\s+\w+)?)\s*-\s*/i, '')
    .replace(/^PT\.?\s*-\s*PT\b/i, 'PT')
    .replace(/\s+-\s*$/, '')
    .trim();

  if (!value) return '';

  const tokens = value.split(' ').filter(Boolean);
  const deduped: string[] = [];
  for (const token of tokens) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.toLowerCase() === token.toLowerCase()) continue;
    deduped.push(token);
  }
  value = deduped.join(' ').trim();

  // Beberapa OCR memberi bentuk "PT - X", sederhanakan jadi "PT X".
  value = value
    .replace(/^PT\s*-\s*/i, 'PT ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (value.startsWith('-')) {
    value.replace('-', '');
  }
  return value;
}

// Kata kunci PDF yang BUKAN merupakan nilai nama cabang.
const CABANG_NOISE_PATTERN =
  /^(?:Baki\s+Debet|Tanggal\s+Update|Kualitas|Pelapor|Cabang|Kredit\/Pembiayaan|No\s+Rekening|Sifat|Jenis|Akad|Plafon|Kondisi|Valuta|Frekuensi|Tunggakan|Denda|Suku|Kategori|Sektor)\b/i;

function sanitizeCabang(value: string): string {
  const v = cleanToken(value, 120);
  if (!v || CABANG_NOISE_PATTERN.test(v)) return '';
  return v;
}

function extractCabangFromRawLines(rawPage: string): string {
  const lines = rawPage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = line.match(/^Cabang\s*[:\-]?\s*(.+)$/i);
    if (inline && inline[1]) {
      const value = sanitizeCabang(inline[1]);
      if (value) return value;
    }
    // When "Cabang" is a standalone header line, skip column-header noise lines
    // and look for the first non-noise, non-amount, non-date line.
    if (/^Cabang$/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const candidate = lines[j];
        if (
          candidate &&
          !CABANG_NOISE_PATTERN.test(candidate) &&
          !/^Rp\b/i.test(candidate) &&
          !/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agt|Sep|Okt|Nov|Des)/i.test(
            candidate,
          ) &&
          !/^\d{3,6}\s*[-–]/i.test(candidate)
        ) {
          const value = sanitizeCabang(candidate);
          if (value) return value;
          break;
        }
      }
    }
  }

  return '';
}

/**
 * Ekstrak cabang dari teks header yang ternormalisasi menggunakan nama pelapor
 * sebagai jangkar. Cabang = teks antara nama pelapor dan "Rp <angka>".
 */
function extractCabangByPelapor(headerSlice: string, pelapor: string): string {
  if (!pelapor || !headerSlice) return '';
  const escaped = pelapor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = headerSlice.match(
    new RegExp(escaped + '\\s+(.+?)\\s+Rp\\s+[\\d.,]', 'i'),
  );
  if (!m || !m[1]) return '';
  return sanitizeCabang(m[1]);
}

function normalizeKondisi(rawKondisi: string, page: string): string {
  const raw = cleanToken(rawKondisi, 120);
  const source = `${raw} ${page}`.toLowerCase();
  const compact = source
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Prioritas kondisi negatif/khusus agar tidak tertimpa keyword umum.
  if (
    compact.includes('lunas dengan diskon') ||
    /\blunas\b(?:\s+\w+){0,4}\sdiskon\b/.test(compact)
  ) {
    return 'Lunas Dengan Diskon';
  }
  if (
    compact.includes('dihapusbukukan') ||
    compact.includes('hapus bukukan') ||
    /\bhapus\b(?:\s+\w+){0,3}\sbuku(?:kan)?\b/.test(compact)
  ) {
    return 'Dihapusbukukan';
  }
  if (
    compact.includes('hapus tagih') ||
    /\bhapus\b(?:\s+\w+){0,4}\stagih\b/.test(compact)
  ) {
    return 'Hapus Tagih';
  }
  if (source.includes('pengambilalihan') && source.includes('agunan')) {
    return 'Lunas karena Pengambilalihan Agunan';
  }
  if (source.includes('pengadilan')) {
    return 'Lunas karena Putusan Pengadilan';
  }
  if (source.includes('dialihkan') && source.includes('pelapor lain')) {
    return 'Dialihkan ke Pelapor Lain';
  }
  if (source.includes('dialihkan') && source.includes('fasilitas lain')) {
    return 'Dialihkan ke Fasilitas Lain';
  }
  if (source.includes('dibatalkan')) {
    return 'Dibatalkan';
  }
  if (source.includes('lunas')) {
    return 'Lunas';
  }
  if (source.includes('aktif')) {
    return 'Aktif';
  }

  return raw || 'Aktif';
}

function normalizeAlphaNum(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').trim();
}

const MONTH_ALIASES: Record<string, string> = {
  jan: 'Jan',
  januari: 'Jan',
  feb: 'Feb',
  februari: 'Feb',
  mar: 'Mar',
  maret: 'Mar',
  apr: 'Apr',
  april: 'Apr',
  mei: 'Mei',
  may: 'Mei',
  jun: 'Jun',
  juni: 'Jun',
  jul: 'Jul',
  juli: 'Jul',
  agt: 'Agt',
  agu: 'Agt',
  agustus: 'Agt',
  aug: 'Agt',
  sep: 'Sep',
  september: 'Sep',
  okt: 'Okt',
  oktober: 'Okt',
  oct: 'Okt',
  nov: 'Nov',
  november: 'Nov',
  des: 'Des',
  desember: 'Des',
  dec: 'Des',
};

function normalizeMonthLabel(raw: string): string {
  const lower = raw.toLowerCase();
  if (MONTH_ALIASES[lower]) return MONTH_ALIASES[lower];
  const matched = Object.keys(MONTH_ALIASES).find((k) => lower.startsWith(k));
  if (matched) return MONTH_ALIASES[matched];
  return raw.slice(0, 3);
}

function extractMonthYearTokens(line: string): string[] {
  const tokens: string[] = [];
  const regex =
    /(Jan(?:uari)?|Feb(?:ruari)?|Mar(?:et)?|Apr(?:il)?|Mei|May|Jun(?:i)?|Jul(?:i)?|Agt|Agu(?:stus)?|Aug|Sep(?:tember)?|Okt(?:ober)?|Oct|Nov(?:ember)?|Des(?:ember)?|Dec)\s*(\d{2})/gi;
  for (const m of line.matchAll(regex)) {
    const month = normalizeMonthLabel(m[1]);
    tokens.push(`${month} ${m[2]}`);
  }
  return tokens;
}

function tokenToDayCandidates(token: string): number[] {
  const normalized = token.replace(/\D/g, '');
  if (!normalized) return [];

  if (normalized.length === 2 && /^[0-9][1-5]$/.test(normalized)) {
    return [parseInt(normalized.slice(0, 1), 10)];
  }

  if (normalized.length >= 4 && /[1-5]$/.test(normalized)) {
    const stripped = parseInt(normalized.slice(0, -1), 10);
    if (!isNaN(stripped) && stripped <= 1500) {
      return [stripped];
    }
  }

  const full = parseInt(normalized, 10);
  return isNaN(full) ? [] : [full];
}

function normalizeMonthlyDayCandidate(
  value: number,
  overallDays: number,
  kualitasKode: number,
): number | null {
  if (!Number.isFinite(value) || value < 0) return null;

  if (overallDays === 0 || kualitasKode <= 1) {
    return value <= 5 ? 0 : null;
  }

  // OCR sering menggabungkan digit kualitas + DPD menjadi 3 digit (mis. 202 -> 20, 232 -> 23)
  // pada kasus DPD aktual yang relatif kecil.
  if (overallDays < 100 && value >= 100 && value <= 999) {
    const compact = Math.floor(value / 10);
    if (compact > 0 && compact <= 99) return compact;
  }

  return value;
}

function extractDayValuesFromChunk(chunk: string): number[] {
  const tokens = chunk.match(/\d+/g) || [];
  const values: number[] = [];
  for (const token of tokens) {
    values.push(...tokenToDayCandidates(token));
  }
  return values.filter((v) => Number.isFinite(v) && v >= 0 && v <= 5000);
}

function inferDayFromChunk(
  chunk: string,
  kualitasKode: number,
  overallDays: number,
): number | null {
  const values = extractDayValuesFromChunk(chunk)
    .map((v) => normalizeMonthlyDayCandidate(v, overallDays, kualitasKode))
    .filter((v): v is number => v !== null);
  if (values.length === 0) {
    return overallDays === 0 ? 0 : null;
  }

  const materialValues = values.filter((v) => v > 5);
  if (materialValues.length > 0) {
    return Math.max(...materialValues);
  }

  if (overallDays === 0 || kualitasKode <= 1) {
    return 0;
  }

  if (values.some((v) => v === overallDays)) {
    return overallDays;
  }

  return null;
}

function extractMonthlyOverdueDaysStrip(
  rawPage: string,
  kualitasKode: number,
  overallDays: number,
): Array<{ month: string; days: number | null }> {
  const lines = rawPage
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const pelaporIdx = lines.findIndex((line) =>
    /Pelapor\s+Cabang\s+Baki\s+Debet\s+Tanggal\s+Update/i.test(line),
  );
  const start = pelaporIdx >= 0 ? pelaporIdx : 0;
  const endIdx = lines.findIndex(
    (line, idx) => idx > start && /Kredit\s+Program\s+Pemerintah/i.test(line),
  );
  const end = endIdx >= 0 ? endIdx : Math.min(lines.length, start + 80);
  const windowLines = lines.slice(start, end);

  const monthLines: Array<{ idx: number; months: string[] }> = [];
  for (let idx = 0; idx < windowLines.length; idx++) {
    const months = extractMonthYearTokens(windowLines[idx]);
    if (months.length > 0) {
      monthLines.push({ idx, months });
    }
  }

  if (monthLines.length === 0) return [];

  const defaultDay = overallDays === 0 || kualitasKode <= 1 ? 0 : null;
  const monthOrder: string[] = [];
  const monthDays = new Map<string, number | null>();

  const setMonthDay = (month: string, days: number | null) => {
    if (!monthDays.has(month)) {
      monthOrder.push(month);
      monthDays.set(month, days);
      return;
    }

    const prev = monthDays.get(month);
    if (prev === null && days !== null) {
      monthDays.set(month, days);
      return;
    }

    if (typeof prev === 'number' && typeof days === 'number' && days > prev) {
      monthDays.set(month, days);
    }
  };

  for (let i = 0; i < monthLines.length; i++) {
    const current = monthLines[i];
    const nextIdx =
      i < monthLines.length - 1 ? monthLines[i + 1].idx : windowLines.length;
    const chunk = windowLines.slice(current.idx + 1, nextIdx).join(' ');
    const values = extractDayValuesFromChunk(chunk)
      .map((v) => normalizeMonthlyDayCandidate(v, overallDays, kualitasKode))
      .filter((v): v is number => v !== null);

    if (current.months.length === 1) {
      const inferred = inferDayFromChunk(chunk, kualitasKode, overallDays);
      setMonthDay(current.months[0], inferred ?? defaultDay);
      continue;
    }

    if (values.length >= current.months.length) {
      const selected = values.slice(-current.months.length);
      for (let j = 0; j < current.months.length; j++) {
        const dayValue =
          (overallDays === 0 || kualitasKode <= 1) && selected[j] <= 5
            ? 0
            : selected[j];
        setMonthDay(current.months[j], dayValue);
      }
      continue;
    }

    if (values.length === 1) {
      if (overallDays === 0 || kualitasKode <= 1) {
        for (const month of current.months) {
          setMonthDay(month, 0);
        }
      } else {
        for (let j = 0; j < current.months.length - 1; j++) {
          setMonthDay(current.months[j], defaultDay);
        }
        const value = values[0] > 5 ? values[0] : defaultDay;
        setMonthDay(current.months[current.months.length - 1], value);
      }
      continue;
    }

    if (values.length > 1 && values.length < current.months.length) {
      const leadCount = current.months.length - values.length;
      for (let j = 0; j < leadCount; j++) {
        setMonthDay(current.months[j], defaultDay);
      }
      for (let j = 0; j < values.length; j++) {
        const month = current.months[leadCount + j];
        const dayValue =
          (overallDays === 0 || kualitasKode <= 1) && values[j] <= 5
            ? 0
            : values[j];
        setMonthDay(month, dayValue);
      }
      continue;
    }

    for (const month of current.months) {
      setMonthDay(month, defaultDay);
    }
  }

  let strip = monthOrder.map((month) => ({
    month,
    days: monthDays.get(month) ?? defaultDay,
  }));

  if (strip.length > 12) {
    strip = strip.slice(-12);
  }

  return strip;
}

function qualityFromOverdueDays(
  days: number | null,
  kualitasKode: number,
): number {
  if (days === null) return Math.max(1, Math.min(5, kualitasKode || 1));
  if (days <= 0) return 1;
  if (days <= 30) return 2;
  if (days <= 60) return 3;
  if (days <= 90) return 4;
  return 5;
}

function buildMonthlyQualityStrip(
  monthlyOverdueStrip: Array<{ month: string; days: number | null }>,
  kualitasKode: number,
): Array<{ month: string; quality: number }> {
  if (monthlyOverdueStrip.length === 0) {
    return Array.from({ length: 12 }, (_, idx) => ({
      month: `Month ${idx + 1}`,
      quality: Math.max(1, Math.min(5, kualitasKode || 1)),
    }));
  }

  const strip = monthlyOverdueStrip.map((entry) => ({
    month: (entry.month.split(/\s+/)[0] || entry.month).trim(),
    quality: qualityFromOverdueDays(entry.days, kualitasKode),
  }));

  return strip.slice(-12);
}

// =============================================
// CLASSIFIER PELAPOR
// =============================================

function classifyPelapor(pelapor: string): SLIKFacility['pelapor_type'] {
  const normalized = pelapor.toLowerCase();

  const bankKeywords = [
    'bank',
    'bca',
    'bri',
    'bni',
    'mandiri',
    'bpr',
    'bprs',
    'btpn',
    'danamon',
    'permata',
    'cimb',
    'maybank',
    'ocbc',
  ];
  const pinjolKeywords = [
    'kredivo',
    'akulaku',
    'shopee pay',
    'gopay',
    'ovo',
    'dana',
    'kredit pintar',
    'julo',
    'tunaiku',
    'findaya',
    'koinworks',
    'modalku',
    'amartha',
    'investree',
    'funding societies',
    'home credit',
    'adakami',
    'pinjam modal',
    'cashcepat',
    'cicilan',
    'paylater',
    'pay later',
    'bnpl',
    'pinjol',
    'fintech',
    'lending',
    'p2p',
    'peer to peer',
  ];
  const multifinanceKeywords = [
    'adira',
    'fif',
    'federal international finance',
    'capella',
    'mandiri tunas finance',
    'wom finance',
    'bfi finance',
    'clipan',
    'oto',
    'surya artha nusantara',
    'verena',
    'mega finance',
    'central santosa finance',
    'indomobil',
    'multifinance',
    'pembiayaan',
    'finance',
  ];

  if (bankKeywords.some((k) => normalized.includes(k))) return 'Bank';
  if (pinjolKeywords.some((k) => normalized.includes(k))) return 'Pinjol_BNPL';
  if (multifinanceKeywords.some((k) => normalized.includes(k)))
    return 'Multifinance';

  return 'Lainnya';
}

// =============================================
// PARSER IMPLEMENTATIONS
// =============================================

function parseDebiturPokok(
  text: string,
  warnings: string[],
): SLIKDebiturPokok[] {
  const normalized = normalizeText(text);

  const namaParts = normalized.match(
    /Nama\s+Sesuai\s+Identitas[\s\S]{0,220}?([A-Z][A-Z'.-]+)\s+NIK(?:\s+([A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+){0,2}))?\s*\/\s*(LAKI-LAKI|PEREMPUAN)/i,
  );
  const nama = cleanToken(
    namaParts
      ? `${namaParts[1]}${namaParts[2] ? ` ${namaParts[2]}` : ''}`
      : extractRegex(
          normalized,
          /([A-Z][A-Z'.-]*(?:\s+[A-Z][A-Z'.-]*){0,4})\s+NIK\s*\/\s*(?:LAKI-LAKI|PEREMPUAN)\b/,
        ),
    80,
  );

  const nik =
    extractRegex(normalized, /NIK\s*\/\s*[A-Z\s'.-]+\s*\/\s*(\d{16})/i) ||
    extractRegex(normalized, /\b(\d{16})\b/) ||
    '0000000000000000';
  const jenis_kelamin =
    extractRegex(normalized, /(LAKI-LAKI|PEREMPUAN)/i) || 'LAKI-LAKI';

  const tempat_lahir = cleanToken(
    extractRegex(
      normalized,
      /\/\s*(?:LAKI-LAKI|PEREMPUAN)\s*\/\s*([A-Z][A-Z\s'.-]{2,40})\s*\/\s*PT\b/i,
    ) || extractRegex(normalized, /\/\s*([A-Z][A-Z\s'.-]{2,40})\s*\/\s*PT\b/i),
    60,
  );

  const tanggalLahirRaw =
    extractRegex(
      normalized,
      /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+Alamat/i,
    ) || extractRegex(normalized, /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+Alamat/i);
  const tanggal_lahir = parseIndonesianDate(tanggalLahirRaw);

  const alamat = cleanToken(
    extractRegex(
      normalized,
      /Alamat\s+Kelurahan\s+Kecamatan\s+Kabupaten\s+Kode\s+Negara\s*\/\s*Pos\s+Kota\s+(.+?)\s+Pekerjaan\s+Tempat\s+Bekerja/i,
    ),
    220,
  );

  const pekerjaanSegment = cleanToken(
    extractRegex(
      normalized,
      /Pekerjaan\s+Tempat\s+Bekerja\s+Bidang\s+Status\s+Usaha\s+Gelar\s+Debitur\s+(.+?)(?:\s+Nama\s+Sesuai\s+Identitas|\s+Ringkasan\s+Fasilitas)/i,
    ),
    220,
  );

  const pekerjaan = cleanToken(
    extractRegex(pekerjaanSegment, /^([A-Za-z/-]{3,})/),
    40,
  );
  const tempatBekerjaRaw = cleanToken(
    extractRegex(pekerjaanSegment, /^[A-Za-z/-]{3,}\s+([A-Za-z-]{3,})/),
    60,
  );
  let tempat_bekerja = /^(sedang|usaha|gelar|debitur|status)$/i.test(
    tempatBekerjaRaw,
  )
    ? ''
    : tempatBekerjaRaw;
  if (!tempat_bekerja) {
    const tempatBekerjaFallback = cleanToken(
      extractRegex(
        pekerjaanSegment,
        /(?:Administrasi|Wiraswasta|Lain-lain|Karyawan)\s+([A-Za-z][A-Za-z0-9.-]{3,})/i,
      ),
      60,
    );
    if (
      tempatBekerjaFallback &&
      !/^(sedang|usaha|gelar|debitur|status|aktivitas)$/i.test(
        tempatBekerjaFallback,
      )
    ) {
      tempat_bekerja = tempatBekerjaFallback;
    }
  }

  let bidang_usaha = '';
  const lowerJob = pekerjaanSegment.toLowerCase();
  if (lowerJob.includes('perdagangan')) bidang_usaha = 'Perdagangan';
  else if (lowerJob.includes('jasa')) bidang_usaha = 'Jasa';
  else if (lowerJob.includes('pertanian')) bidang_usaha = 'Pertanian';

  let npwp: string | null = extractRegex(normalized, /\b(\d{15})\b/);
  if (npwp === nik) npwp = null;

  if (!nama) warnings.push('Nama Debitur tidak ditemukan');
  if (nik === '0000000000000000') warnings.push('NIK Debitur tidak ditemukan');
  if (!tanggal_lahir) warnings.push('Tanggal lahir Debitur tidak ditemukan');

  return [
    {
      nama: nama || 'Unknown',
      nik,
      npwp,
      jenis_kelamin,
      tempat_lahir,
      tanggal_lahir,
      pekerjaan,
      tempat_bekerja,
      bidang_usaha,
      alamat,
    },
  ];
}

function parseRingkasanFasilitas(
  text: string,
  _warnings: string[],
): SLIKRingkasanFasilitas {
  const normalized = normalizeText(text);
  const ringkasanSection =
    extractRegex(
      normalized,
      /Ringkasan\s+Fasilitas\s+(.+?)\s+Nomor\s+\d+\/IDEB\//i,
    ) || normalized;

  const plafonMatch =
    extractRegex(ringkasanSection, /Plafon\s+([\d.,]+)\s+Efektif/i) ||
    extractRegex(ringkasanSection, /Plafon\s+Efektif\s+([\d.,]+)/i);
  const bakiMatch =
    extractRegex(ringkasanSection, /Baki\s+([\d.,]+)\s+Debet/i) ||
    extractRegex(ringkasanSection, /Baki\s+Debet\s+([\d.,]+)/i);

  const bankCount = parseInt(
    extractRegex(ringkasanSection, /Bank\s+(\d+)/i) || '0',
    10,
  );
  const bprCount = parseInt(
    extractRegex(ringkasanSection, /BPR(?:S)?\s+(\d+)/i) || '0',
    10,
  );

  let multifinanceCount = parseInt(
    extractRegex(ringkasanSection, /Lembaga\s+Pembiayaan\s+(\d+)/i) || '0',
    10,
  );
  let lainnyaCount = parseInt(
    extractRegex(ringkasanSection, /Lainnya\s+(\d+)/i) || '0',
    10,
  );

  // Pada OCR tertentu "20" adalah gabungan "2" (lembaga pembiayaan) dan "0" (lainnya).
  if (multifinanceCount === 0 && lainnyaCount === 0) {
    const mergedCount = ringkasanSection.match(
      /Umum\s+(\d)(\d)\s*\/\s*Lembaga/i,
    );
    if (mergedCount) {
      multifinanceCount = parseInt(mergedCount[1], 10);
      lainnyaCount = parseInt(mergedCount[2], 10);
    }
  }

  const total = bankCount + bprCount + multifinanceCount + lainnyaCount;

  const kualitasRaw = ringkasanSection.match(
    /(\d)\s*\/\s*([A-Za-z]+\s+\d{4})/i,
  );
  const kualitasKode = kualitasRaw ? parseInt(kualitasRaw[1], 10) : 1;
  const bulanTerakhir = kualitasRaw ? kualitasRaw[2] : '';

  return {
    plafon_efektif_total: parseFormattedNumber(plafonMatch),
    baki_debet_total: parseFormattedNumber(bakiMatch),
    jumlah_kreditur_bank_umum: bankCount,
    jumlah_kreditur_bpr_bprs: bprCount,
    jumlah_kreditur_lembaga_pembiayaan: multifinanceCount,
    jumlah_kreditur_lainnya: lainnyaCount,
    total_fasilitas: total,
    kualitas_terburuk_kode: kualitasKode,
    bulan_data_terakhir: bulanTerakhir,
  };
}

function parseFacilities(
  pageTexts: string[],
  rawPageTexts: string[],
  warnings: string[],
): SLIKFacility[] {
  const facilities: SLIKFacility[] = [];
  const pelaporByCode: Record<string, string> = {
    // Multifinance / lembaga pembiayaan
    '251540': 'PT Federal International Finance',
    '290220': 'PT Astra Multi Finance',
    '261210': 'PT Capella Multidana',
    '017849': 'PT Stanford Teknologi Indonesia',
    '252620': 'PT Commerce',
    '246001': 'PT Permodalan Nasional Madani',
    '252250': 'PT Multifinance Anak Bangsa',
    // Bank umum — kode sandi OJK standar 3 digit
    '002': 'PT Bank Rakyat Indonesia (Persero) Tbk',
    '008': 'PT Bank Mandiri (Persero) Tbk',
    '009': 'PT Bank Negara Indonesia (Persero) Tbk',
    '014': 'PT Bank Central Asia Tbk',
    '016': 'PT Bank Danamon Indonesia Tbk',
    '019': 'PT Bank Permata Tbk',
    '022': 'PT Bank CIMB Niaga Tbk',
    '028': 'PT Bank OCBC NISP Tbk',
    '031': 'PT Bank Tabungan Negara (Persero) Tbk',
    '047': 'PT Bank Tabungan Pensiunan Nasional Tbk',
    '076': 'PT Bank Bukopin Tbk',
    '200': 'PT Bank Tabungan Negara Syariah',
    '422': 'PT Bank Syariah Indonesia Tbk',
    '427': 'PT Bank Mega Tbk',
    '426': 'PT Bank Mega Tbk',
    '542': 'PT Bank Jago Tbk',
    '553': 'PT Amar Bank',
    '046': 'PT Bank DBS Indonesia',
    '111': 'PT BPD Sumatera Utara',
    '113': 'PT BPD Sumatera Barat',
    '116': 'PT BPD Riau dan Kepri',
    '118': 'PT BPD Sumatera Selatan dan Bangka Belitung',
    '119': 'PT BPD Lampung',
    '120': 'PT BPD DKI',
    '122': 'PT BPD Jawa Barat dan Banten',
    '125': 'PT BPD Jawa Tengah',
    '130': 'PT BPD Jawa Timur',
    '135': 'PT BPD Kalimantan Barat',
    '137': 'PT BPD Kalimantan Tengah',
    '138': 'PT BPD Kalimantan Selatan',
    '142': 'PT BPD Sulawesi Tengah',
    '145': 'PT BPD Sulawesi Utara Gorontalo',
    '146': 'PT BPD Nusa Tenggara Timur',
    '147': 'PT BPD Bali',
  };

  for (let i = 0; i < pageTexts.length; i++) {
    const rawPage = rawPageTexts[i] || pageTexts[i];
    const page = normalizeText(pageTexts[i]);
    const pageDateSource = `${page} ${normalizeText(rawPage)}`.trim();

    if (!/^Kredit\/Pembiayaan\b/i.test(page)) {
      continue;
    }

    if (!/Pelapor\s+Cabang\s+Baki\s+Debet\s+Tanggal\s+Update/i.test(page)) {
      continue;
    }

    // Halaman detail fasilitas wajib punya kualitas + plafon awal.
    if (
      !/Kualitas\s+\d\s*-/i.test(page) ||
      !/Plafon(?:\s+[A-Za-z]+)?\s+Rp\s+Awal/i.test(page)
    ) {
      continue;
    }

    const kodePelapor =
      extractRegex(
        page,
        /Pelapor\s+Cabang\s+Baki\s+Debet\s+Tanggal\s+Update\s+(\d{3,6})\b/i,
      ) || '';

    const shortCodeDpd = parseInt(
      extractRegex(page, /Jumlah\s+(\d+)\s+Hari\s+Tunggakan/i) || '0',
      10,
    );
    const shortCodeKondisi =
      extractRegex(page, /Kondisi\s+(.+?)\s+Valuta/i) || '';
    const shortCodeRisky =
      /Kualitas\s+[3-5]\s*-/i.test(page) ||
      shortCodeDpd > 30 ||
      /Dihapusbukukan|Hapus\s*Tagih|Diragukan|Macet/i.test(shortCodeKondisi);

    // Kode 3 digit: izinkan jika (a) sudah ada di peta pelaporByCode,
    // (b) nama bank terkenal terbaca di halaman, (c) fasilitas berisiko tinggi.
    const knownShortCode = !!pelaporByCode[kodePelapor];
    const allowShortCode =
      knownShortCode ||
      /Bank\s+(?:Rakyat|Mandiri|Negara|Central\s+Asia|BCA|Danamon|Permata|CIMB|OCBC|BTN|BTPN|BRI|BNI|Mega|Jago|Artos|Syariah\s+Indonesia|DBS|Bukopin)/i.test(
        page,
      );
    if (
      kodePelapor &&
      kodePelapor.length < 5 &&
      !allowShortCode &&
      !shortCodeRisky
    ) {
      continue;
    }

    const headerEnd = page.indexOf('Kualitas /');
    const headerSlice =
      headerEnd > 0 ? page.slice(0, headerEnd) : page.slice(0, 360);

    const pelaporHeaderRaw = extractRegex(
      headerSlice,
      /Pelapor\s+(.+?)\s+Cabang\s+/i,
    );

    let pelapor = pelaporByCode[kodePelapor] || '';
    const pelaporHeader = normalizePelaporName(pelaporHeaderRaw || '');
    if (pelaporHeader) {
      pelapor = pelaporHeader;
    }
    if (!pelapor && /Federal\s+International/i.test(page)) {
      pelapor = 'PT Federal International Finance';
    } else if (!pelapor && /Astra\s+Multi/i.test(page)) {
      pelapor = 'PT Astra Multi Finance';
    } else if (!pelapor && /Capella/i.test(page) && /Multidana/i.test(page)) {
      pelapor = 'PT Capella Multidana';
    } else if (!pelapor && /Stanford/i.test(page)) {
      pelapor = 'PT Stanford Teknologi Indonesia';
    } else if (!pelapor && /Commerce/i.test(page) && /Finance/i.test(page)) {
      pelapor = 'PT Commerce';
    } else if (
      !pelapor &&
      /Permodalan/i.test(page) &&
      /Nasional|Madani/i.test(page)
    ) {
      pelapor = 'PT Permodalan Nasional Madani';
    } else if (
      !pelapor &&
      /Multifinance/i.test(page) &&
      /Anak\s+Bangsa/i.test(page)
    ) {
      pelapor = 'PT Multifinance Anak Bangsa';
    } else if (!pelapor && /Bank\s+Jago|Artos/i.test(page)) {
      pelapor = 'PT Bank Jago Tbk';
    } else if (!pelapor) {
      pelapor = cleanToken(
        extractRegex(
          page,
          /Pelapor\s+Cabang\s+Baki\s+Debet\s+Tanggal\s+Update\s+\d{3,6}\s+(.+?)\s+Rp(?:\s*[A-Za-z.-]+)?\s*[\d.,]+/i,
        ),
        80,
      );
      pelapor = pelapor
        .replace(
          /\s+(?:Rp|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agt|Sep|Okt|Nov|Des)).*$/i,
          '',
        )
        .replace(/\s+-\s*$/, '')
        .trim();
      pelapor = normalizePelaporName(pelapor);
    }

    if (!pelapor) {
      continue;
    }

    let cabang =
      extractCabangByPelapor(headerSlice, pelapor) ||
      extractCabangFromRawLines(rawPage);
    if (!cabang) {
      if (/TEMBUNG/i.test(headerSlice)) cabang = 'KC TEMBUNG';
      else if (/KC\s*-\s*PT\s+Medan/i.test(headerSlice)) cabang = 'KC MEDAN';
    }

    const bakiDebetRaw =
      extractRegex(headerSlice, /Rp\s*([\d.,]+)/i) ||
      extractRegex(page, /Baki\s+Debet\s+([\d.,]+)/i) ||
      '0';
    const bakiDebet = parseFormattedNumber(bakiDebetRaw);

    const dayUpdate =
      extractRegex(
        headerSlice,
        /Rp\s*(?:[A-Za-z]+\s+)?[\d.,]+\s+(\d{1,2})\b/i,
      ) || extractRegex(headerSlice, /Rp\s+[A-Za-z]+\s*[\d.,]+\s+(\d{1,2})\b/i);
    const monthYearUpdate = headerSlice.match(
      /(Jan(?:uari)?|Feb(?:ruari)?|Mar(?:et)?|Apr(?:il)?|Mei|Jun(?:i)?|Jul(?:i)?|Agt|Agu(?:stus)?|Sep(?:tember)?|Okt(?:ober)?|Nov(?:ember)?|Des(?:ember)?)\s+(\d{4})/i,
    );
    const tanggalUpdate =
      dayUpdate && monthYearUpdate
        ? parseIndonesianDate(
            `${dayUpdate} ${monthYearUpdate[1]} ${monthYearUpdate[2]}`,
          )
        : null;

    const kualitasRaw = page.match(/Kualitas\s+(\d)\s*-\s*([A-Za-z]+)/i);
    const kualitasKode = kualitasRaw ? parseInt(kualitasRaw[1], 10) : 1;
    const kualitasLabel = kualitasRaw
      ? `${kualitasKode} - ${cleanToken(kualitasRaw[2], 20)}`
      : `${kualitasKode} - Lancar`;

    const noRekeningRaw = cleanToken(
      extractRegex(
        page,
        /No\s+Rekening\s+(.+?)\s+(?:Sifat|Jenis|Akad|Plafon|Tanggal|Kualitas|Kondisi|Valuta)/i,
      ) || extractRegex(page, /No\s+Rekening\s+([^\s]+)/i),
      80,
    );
    const noRekeningCandidate = normalizeAlphaNum(noRekeningRaw);
    const noRekening =
      /^(Kualitas|Sifat|Jenis|Akad|Plafon|Tanggal|Kondisi|Valuta)/i.test(
        noRekeningCandidate,
      )
        ? ''
        : noRekeningCandidate;
    const plafonAwalRaw =
      extractRegex(page, /Plafon\s+Rp\s+Awal\s+([\d.,]+)/i) || '0';
    const plafonRaw =
      extractRegex(page, /Perpanjangan\s+Plafon\s+Rp\s+([\d.,]+)/i) ||
      extractRegex(page, /Plafon\s+Rp\s+(?!Awal)([\d.,]+)/i) ||
      '0';

    const sifatKredit =
      cleanToken(
        extractRegex(page, /Sifat\s+([A-Za-z-]+)\s+Kredit\/Pembiayaan/i),
        40,
      ) || 'Lainnya';

    let jenisPenggunaan = cleanToken(
      extractRegex(page, /Jenis\s+([A-Za-z ]+?)\s+Penggunaan/i),
      40,
    );
    if (/modal/i.test(jenisPenggunaan)) jenisPenggunaan = 'Modal Kerja';

    const jenisKredit = /Non-UMKM/i.test(page)
      ? 'Non-UMKM'
      : cleanToken(
          extractRegex(page, /Jenis\s+([A-Za-z-]+)\s+Kredit\/Pembiayaan/i),
          40,
        ) || 'Lainnya';

    const akad = cleanToken(
      extractRegex(page, /Akad\s+(Konvensional|Syariah)/i),
      30,
    );
    const sukuBunga = parseFloat(
      extractRegex(page, /Suku\s+([\d.]+)\s+Bunga\/Imbalan/i) || '0',
    );
    const jenisSukuBunga = cleanToken(
      extractRegex(page, /Bunga\/Imbalan\s+(Fixed|Floating)/i),
      20,
    );

    let kategoriDebitur = cleanToken(
      extractRegex(page, /Kategori\s+(.+?)\s+Jenis/i),
      90,
    );
    if (/Mikro|Kecil|Menengah/i.test(page)) {
      kategoriDebitur = 'Mikro, Kecil, Menengah';
    }
    if (/Bukan\s+Debitur/i.test(page)) {
      kategoriDebitur = 'Bukan Debitur UMKM';
    }

    let sektorEkonomi = cleanToken(
      extractRegex(page, /Sektor\s+([A-Za-z ]+?)\s+Ekonomi/i),
      80,
    );
    if (/Jasa\s+Perorangan\s+Lainnya/i.test(page)) {
      sektorEkonomi = 'Aktivitas Jasa Perorangan Lainnya';
    }
    if (/Perdagangan\s+.*Sepeda\s+Motor/i.test(page)) {
      sektorEkonomi = 'Perdagangan Sepeda Motor';
    }

    const kondisiRaw =
      extractRegex(
        page,
        /Kondisi\s+([\s\S]{1,100}?)(?=\s+(?:Tanggal|Valuta|Jumlah\s+\d+\s+Hari\s+Tunggakan|Frekuensi|Tunggakan|Sebab|Suku|Kategori|Sektor)\b)/i,
      ) ||
      extractRegex(page, /Kondisi\s+(.+?)\s+Tanggal/i) ||
      extractRegex(page, /Kondisi\s+(.+?)\s+Valuta/i) ||
      extractRegex(
        page,
        /Kondisi\s+(.+?)\s+Jumlah\s+\d+\s+Hari\s+Tunggakan/i,
      ) ||
      '';
    const kondisi = normalizeKondisi(kondisiRaw, page);

    const tglKondisiMatch = page.match(
      /Tanggal\s+(\d{1,2})\s+Kondisi\s+([A-Za-z]+)\s+(\d{4})/i,
    );
    const tanggalKondisi = tglKondisiMatch
      ? parseIndonesianDate(
          `${tglKondisiMatch[1]} ${tglKondisiMatch[2]} ${tglKondisiMatch[3]}`,
        )
      : null;

    const tanggalAkadAwal = extractDateAroundLabel(
      pageDateSource,
      /Tanggal\s+Akad\s+Awal/,
    );
    const tanggalAkadAkhir = extractDateAroundLabel(
      pageDateSource,
      /Tanggal\s+Akad\s+Akhir/,
    );
    const extractedTanggalMulai = extractDateAroundLabel(
      pageDateSource,
      /Tanggal\s+Mulai/,
    );
    const extractedTanggalAwalKredit = extractDateAroundLabel(
      pageDateSource,
      /Tanggal\s+Awal(?:\s+Kredit(?:\/Pembiayaan)?)?/,
    );
    const tanggalMulai = extractedTanggalMulai || extractedTanggalAwalKredit;
    const tanggalAwalKredit = extractedTanggalAwalKredit || tanggalMulai;
    const tanggalJatuhTempo = extractDateAroundLabel(
      pageDateSource,
      /Tanggal\s+Jatuh\s+Tempo/,
    );

    const tunggakanPokokRaw =
      extractRegex(
        page,
        /Tunggakan\s+Kredit\s+Rp\s*(?:\d{4}\s+)?([\d.,]+)\s+Pokok/i,
      ) ||
      extractRegex(page, /Tunggakan\s+Kredit[\s\S]{0,40}?([\d.,]+)\s+Pokok/i) ||
      '0';
    const tunggakanBungaRaw =
      extractRegex(page, /Tunggakan\s+Rp\s*(?:\d{4}\s+)?([\d.,]+)\s+Bunga/i) ||
      extractRegex(page, /Tunggakan[\s\S]{0,40}?([\d.,]+)\s+Bunga/i) ||
      '0';

    const dendaRaw = extractRegex(page, /Denda\s+Rp\s*([\d.,]+)/i) || '0';
    const jumlahHariTunggakanRaw =
      extractRegex(page, /Jumlah\s+(\d+)\s+Hari\s+Tunggakan/i) ||
      extractRegex(page, /Tempo\s+(\d+)\s+Tunggakan/i) ||
      '0';
    const frekuensiTunggakanRaw =
      extractRegex(page, /Tempo\s+(\d+)\s+Tunggakan/i) || '0';
    const frekuensiRestruRaw =
      extractRegex(page, /Frekuensi\s+(\d+)\s+Restrukturisasi/i) || '0';

    const sebabMacet = cleanToken(
      extractRegex(page, /Sebab\s+Macet\s+(?!Tanggal)([A-Za-z\s-]+)/i),
      80,
    );

    const jumlahHariTunggakan = parseInt(jumlahHariTunggakanRaw, 10) || 0;
    const monthlyOverdueStrip = extractMonthlyOverdueDaysStrip(
      rawPage,
      kualitasKode,
      jumlahHariTunggakan,
    );
    const strip = buildMonthlyQualityStrip(monthlyOverdueStrip, kualitasKode);

    facilities.push({
      pelapor,
      pelapor_type: classifyPelapor(pelapor),
      cabang,
      no_rekening: noRekening,
      baki_debet: bakiDebet,
      tanggal_update: tanggalUpdate,
      kualitas_kode: kualitasKode,
      kualitas_label: kualitasLabel,
      kondisi,
      tanggal_kondisi: tanggalKondisi,
      sebab_macet: sebabMacet || null,
      tanggal_macet: null,
      jumlah_hari_tunggakan: jumlahHariTunggakan,
      frekuensi_tunggakan: parseInt(frekuensiTunggakanRaw, 10),
      tunggakan_pokok: parseFormattedNumber(tunggakanPokokRaw),
      tunggakan_bunga: parseFormattedNumber(tunggakanBungaRaw),
      denda: parseFormattedNumber(dendaRaw),
      plafon_awal: parseFormattedNumber(plafonAwalRaw),
      plafon: parseFormattedNumber(plafonRaw),
      sifat_kredit: sifatKredit,
      frekuensi_restrukturisasi: parseInt(frekuensiRestruRaw, 10),
      cara_restrukturisasi: '',
      jenis_penggunaan: jenisPenggunaan,
      jenis_kredit: jenisKredit,
      akad,
      suku_bunga: isNaN(sukuBunga) ? 0 : sukuBunga,
      jenis_suku_bunga: jenisSukuBunga,
      kategori_debitur: kategoriDebitur,
      tanggal_akad_awal: tanggalAkadAwal,
      tanggal_akad_akhir: tanggalAkadAkhir,
      tanggal_mulai: tanggalMulai,
      tanggal_awal_kredit: tanggalAwalKredit,
      tanggal_jatuh_tempo: tanggalJatuhTempo,
      sektor_ekonomi: sektorEkonomi,
      kredit_program_pemerintah: !/bukan\s+merupakan\s+pembiayaan/i.test(page),
      monthly_quality_strip: strip,
      monthly_overdue_days_strip: monthlyOverdueStrip,
    });
  }

  if (facilities.length === 0) {
    warnings.push(
      'Tidak ada fasilitas yang berhasil diparse dari halaman detail kredit',
    );
  }

  return facilities;
}

function reconcileFacilityDuplicates(
  facilities: SLIKFacility[],
  targetTotal: number,
  warnings: string[],
): SLIKFacility[] {
  if (targetTotal <= 0 || facilities.length <= targetTotal) {
    return facilities;
  }

  const overflow = facilities.length - targetTotal;

  // Kandidat trim: entri placeholder low-risk yang sangat mungkin duplikat OCR.
  const duplicateBuckets = new Map<string, number[]>();
  for (let i = 0; i < facilities.length; i++) {
    const fac = facilities[i];
    const isPlaceholderDuplicateCandidate =
      !cleanToken(fac.no_rekening) &&
      fac.baki_debet === 0 &&
      fac.kualitas_kode <= 1 &&
      fac.jumlah_hari_tunggakan === 0 &&
      /lunas/i.test(fac.kondisi || '');

    if (!isPlaceholderDuplicateCandidate) {
      continue;
    }

    // Gunakan fingerprint yang lebih ketat agar fasilitas nyata tidak ikut terpangkas.
    const key = [
      cleanToken(fac.pelapor, 80).toLowerCase(),
      cleanToken(fac.kondisi, 80).toLowerCase(),
      String(fac.kualitas_kode),
      String(fac.plafon_awal || 0),
      String(fac.plafon || 0),
      String(fac.baki_debet || 0),
      fac.tanggal_awal_kredit ? fac.tanggal_awal_kredit.toISOString() : '',
      fac.tanggal_kondisi ? fac.tanggal_kondisi.toISOString() : '',
    ].join('|');

    const list = duplicateBuckets.get(key) || [];
    list.push(i);
    duplicateBuckets.set(key, list);
  }

  const removableIndices: number[] = [];
  const bucketEntries = Array.from(duplicateBuckets.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  for (const [, idxList] of bucketEntries) {
    if (idxList.length <= 1) continue;
    for (let j = 1; j < idxList.length; j++) {
      removableIndices.push(idxList[j]);
    }
  }

  if (removableIndices.length === 0) {
    warnings.push(
      `Ringkasan/detail mismatch: detail memiliki +${overflow} fasilitas dibanding ringkasan; detail dipertahankan untuk mencegah false trim`,
    );
    return facilities;
  }

  const toRemove = new Set(removableIndices.slice(0, overflow));
  if (toRemove.size === 0) {
    return facilities;
  }

  const removedByPelapor = new Map<string, number>();
  for (const idx of toRemove) {
    const pelapor = cleanToken(facilities[idx]?.pelapor, 80) || 'UNKNOWN';
    removedByPelapor.set(pelapor, (removedByPelapor.get(pelapor) || 0) + 1);
  }

  const reconciled = facilities.filter((_, idx) => !toRemove.has(idx));
  warnings.push(
    `Rekonsiliasi dedupe fasilitas: trim ${toRemove.size} entri placeholder duplikat (${facilities.length} -> ${reconciled.length})`,
  );

  const breakdown = Array.from(removedByPelapor.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pelapor, count]) => `${pelapor}:${count}`)
    .join(', ');
  if (breakdown) {
    warnings.push(`Rincian dedupe per pelapor: ${breakdown}`);
  }

  const residualOverflow = facilities.length - targetTotal - toRemove.size;
  if (residualOverflow > 0) {
    warnings.push(
      `Ringkasan/detail mismatch: detail memiliki +${residualOverflow} fasilitas dibanding ringkasan; detail dipertahankan untuk mencegah false trim`,
    );
  }

  return reconciled;
}

function parseAgunan(pageTexts: string[], warnings: string[]): SLIKAgunan[] {
  const agunanList: SLIKAgunan[] = [];

  for (const pageText of pageTexts) {
    const page = normalizeText(pageText);
    if (!/^Agunan\b/i.test(page) && !/\bSegmen\s+A01\b/i.test(page)) {
      continue;
    }

    if (!/Kode\s+Register|Nomor\s+Agunan|Jenis\s+Agunan/i.test(page)) {
      continue;
    }

    const kodeRegister = normalizeAlphaNum(
      extractRegex(
        page,
        /(?:Kode\s+Register|Nomor\s+Agunan)\s+([A-Za-z0-9./-]{3,})/i,
      ),
    );
    const noRekening = normalizeAlphaNum(
      extractRegex(
        page,
        /No(?:mor)?\s+Rekening(?:\s+Fasilitas)?\s+([A-Za-z0-9./-]{3,})/i,
      ),
    );
    const noCif = normalizeAlphaNum(
      extractRegex(
        page,
        /(?:No(?:mor)?\s+CIF\s+Debitur|CIF\s+Debitur)\s+([A-Za-z0-9./-]{3,})/i,
      ),
    );
    const kodeSegmen =
      cleanToken(
        extractRegex(page, /Kode\s+Jenis\s+Segmen\s+Fasilitas\s+(F0[1-6])/i),
        3,
      ).toUpperCase() || '';
    const statusAgunan =
      cleanToken(extractRegex(page, /Status\s+Agunan\s+([12])/i), 1) || '';
    const jenisAgunan =
      cleanToken(extractRegex(page, /Jenis\s+Agunan\s+(\d{3})/i), 3) || '';
    const jenisPengikatan =
      cleanToken(extractRegex(page, /Jenis\s+Pengikatan\s+(\d{2})/i), 2) || '';

    const tglPengikatanMatch = page.match(
      /Tanggal\s+Pengikatan\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    );
    const tanggalPengikatan = tglPengikatanMatch
      ? parseIndonesianDate(tglPengikatanMatch[1])
      : null;

    const namaPemilik = cleanToken(
      extractRegex(
        page,
        /Nama\s+Pemilik\s+Agunan\s+(.+?)\s+Bukti\s+Kepemilikan/i,
      ),
      120,
    );
    const buktiKepemilikan = cleanToken(
      extractRegex(page, /Bukti\s+Kepemilikan\s+(.+?)\s+Alamat\s+Agunan/i),
      120,
    );
    const alamatAgunan = cleanToken(
      extractRegex(
        page,
        /Alamat\s+Agunan\s+(.+?)\s+Kode\s+Kab(?:\/|\s*)Kota|Alamat\s+Agunan\s+(.+?)\s+Nilai\s+Agunan/i,
      ),
      180,
    );
    const kodeKabkota =
      cleanToken(
        extractRegex(
          page,
          /Kode\s+Kab(?:\/|\s*)Kota(?:\s*\(DATI\s*2\))?\s+(\d{4})/i,
        ),
        4,
      ) || '';

    const nilaiNjop = parseFormattedNumber(
      extractRegex(
        page,
        /Nilai\s+Agunan\s+Sesuai\s+NJOP\/Nilai\s+Wajar\s+([\d.,]+)/i,
      ),
    );
    const nilaiPelapor = parseFormattedNumber(
      extractRegex(page, /Nilai\s+Agunan\s+Menurut\s+Pelapor\s+([\d.,]+)/i),
    );

    const statusParipasu =
      (cleanToken(
        extractRegex(page, /Status\s+Paripasu\s+([YT])/i),
        1,
      ).toUpperCase() as 'Y' | 'T' | '') || '';
    const persentaseParipasuRaw = extractRegex(
      page,
      /Persentase\s+Paripasu\s+([\d.,]+)/i,
    );
    const persentaseParipasu = persentaseParipasuRaw
      ? parseFormattedNumber(persentaseParipasuRaw)
      : null;

    const statusKreditJoin =
      (cleanToken(
        extractRegex(page, /Status\s+Kredit\s+Join\s+([YT])/i),
        1,
      ).toUpperCase() as 'Y' | 'T' | '') || '';
    const diasuransikan =
      (cleanToken(
        extractRegex(page, /Diasuransikan\s+([YT])/i),
        1,
      ).toUpperCase() as 'Y' | 'T' | '') || '';

    const kodeCabang =
      cleanToken(
        extractRegex(page, /Kode\s+Kantor\s+Cabang\s+(\d{2,6})/i),
        6,
      ) || '';
    const operasiData =
      (cleanToken(
        extractRegex(page, /Operasi\s+Data\s+([CUDN])/i),
        1,
      ).toUpperCase() as 'C' | 'U' | 'D' | 'N' | '') || '';

    if (!kodeRegister && !noRekening && !jenisAgunan) {
      continue;
    }

    agunanList.push({
      kode_register_agunan: kodeRegister,
      no_rekening_fasilitas: noRekening,
      no_cif: noCif,
      kode_jenis_segmen_fasilitas: kodeSegmen,
      kode_status_agunan: statusAgunan,
      kode_jenis_agunan: jenisAgunan,
      kode_jenis_pengikatan: jenisPengikatan,
      tanggal_pengikatan: tanggalPengikatan,
      nama_pemilik_agunan: namaPemilik,
      bukti_kepemilikan: buktiKepemilikan,
      alamat_agunan: alamatAgunan,
      kode_kabkota_lokasi: kodeKabkota,
      nilai_agunan_njop_wajar: nilaiNjop,
      nilai_agunan_pelapor: nilaiPelapor,
      status_paripasu: statusParipasu,
      persentase_paripasu: persentaseParipasu,
      status_kredit_join: statusKreditJoin,
      diasuransikan,
      kode_kantor_cabang: kodeCabang,
      operasi_data: operasiData,
    });
  }

  if (agunanList.length > 0) {
    warnings.push(`Segmen A01 Agunan terdeteksi: ${agunanList.length} data`);
  }

  return agunanList;
}

// =============================================
// MAIN ENTRY
// =============================================

export async function parseSlikPdf(filePath: string): Promise<ParsedSLIK> {
  const warnings: string[] = [];
  let pdf;
  try {
    pdf = await open(filePath);
    let fullText = '';
    const pageTexts: string[] = [];
    const rawPageTexts: string[] = [];

    // Extract text from all pages
    for (const page of pdf.pages) {
      const pageText = await page.extractText();
      const rawPageText = await page.extractTextRaw({
        detectLineBreaks: true,
        addSpaces: true,
      });
      pageTexts.push(pageText);
      rawPageTexts.push(rawPageText || pageText);
      fullText += pageText + '\n';
    }

    const normalizedFull = normalizeText(fullText);

    const nomorLaporan =
      extractRegex(normalizedFull, /(\d+\/IDEB\/\d+\/\d{4})/i) ||
      extractRegex(normalizedFull, /Nomor\s+Laporan\s*([\w\/]+)/i) ||
      '';

    const tanggalPermintaanRaw =
      extractRegex(
        normalizedFull,
        /Tanggal\s+Permintaan\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      ) ||
      extractRegex(
        normalizedFull,
        /Tanggal\s+Permintaan\s*:\s*([\d\-/\s\w]+)/i,
      );

    const tanggalPermintaan = parseIndonesianDate(tanggalPermintaanRaw);

    let operator =
      extractRegex(normalizedFull, /Operator\s+([A-Za-z\s]+?)\s*\|/i) || '';
    const splitOperator = normalizedFull.match(
      /Operat\s+([A-Za-z]+)\s+\|\s+Tanggal\s+or\s+([A-Za-z]+)/i,
    );
    if (!operator && splitOperator) {
      operator = `${splitOperator[1]} ${splitOperator[2]}`;
    }

    const kodeRefPengguna =
      extractRegex(normalizedFull, /Ref\.?\s+Pengguna\s+(\d{3,})/i) ||
      extractRegex(
        normalizedFull,
        /Ref\.?\s+Pengguna[\s\S]{0,120}?(\d{3,})/i,
      ) ||
      extractRegex(
        normalizedFull,
        /InformasiKode\s+berdasarkan\s+Ref\.?\s+Pengguna\s+(\d{3,})/i,
      ) ||
      '';

    const posisiDataTerakhir =
      extractRegex(
        normalizedFull,
        /Posisi\s+Data\s+Terakhir\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
      ) || '';

    if (!tanggalPermintaan) {
      warnings.push('Gagal parse Tanggal Permintaan - cek format PDF SLIK');
    }

    const earlyPages = pageTexts.slice(0, 4).join('\n') || fullText;
    const debiturPokok = parseDebiturPokok(earlyPages, warnings);
    let facilities = parseFacilities(pageTexts, rawPageTexts, warnings);
    const agunan = parseAgunan(pageTexts, warnings);
    const ringkasanFasilitas = parseRingkasanFasilitas(earlyPages, warnings);

    facilities = reconcileFacilityDuplicates(
      facilities,
      ringkasanFasilitas.total_fasilitas,
      warnings,
    );

    // Sinkronisasi ringkasan dengan detail fasilitas saat OCR tabel ringkasan tidak stabil.
    const facilityStats = facilities.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.baki += item.baki_debet;
        acc.plafon += item.plafon;
        if (item.pelapor_type === 'Bank') acc.bank += 1;
        else if (item.pelapor_type === 'Multifinance') acc.multifinance += 1;
        else if (item.pelapor_type === 'Pinjol_BNPL') acc.pinjol += 1;
        else acc.lainnya += 1;
        return acc;
      },
      {
        total: 0,
        baki: 0,
        plafon: 0,
        bank: 0,
        multifinance: 0,
        pinjol: 0,
        lainnya: 0,
      },
    );

    if (ringkasanFasilitas.total_fasilitas === 0 && facilityStats.total > 0) {
      ringkasanFasilitas.total_fasilitas = facilityStats.total;
    } else if (
      facilityStats.total > 0 &&
      facilityStats.total > ringkasanFasilitas.total_fasilitas
    ) {
      const oldTotal = ringkasanFasilitas.total_fasilitas;
      ringkasanFasilitas.total_fasilitas = facilityStats.total;
      warnings.push(
        `Sinkronisasi total fasilitas: ringkasan ${oldTotal} -> ${facilityStats.total} berdasarkan detail hasil parse`,
      );
    }
    if (
      ringkasanFasilitas.jumlah_kreditur_bank_umum === 0 &&
      ringkasanFasilitas.jumlah_kreditur_bpr_bprs === 0 &&
      ringkasanFasilitas.jumlah_kreditur_lembaga_pembiayaan === 0 &&
      ringkasanFasilitas.jumlah_kreditur_lainnya === 0 &&
      facilityStats.total > 0
    ) {
      ringkasanFasilitas.jumlah_kreditur_bank_umum = facilityStats.bank;
      ringkasanFasilitas.jumlah_kreditur_bpr_bprs = 0;
      ringkasanFasilitas.jumlah_kreditur_lembaga_pembiayaan =
        facilityStats.multifinance + facilityStats.pinjol;
      ringkasanFasilitas.jumlah_kreditur_lainnya = facilityStats.lainnya;
    }
    if (ringkasanFasilitas.baki_debet_total === 0 && facilityStats.baki > 0) {
      ringkasanFasilitas.baki_debet_total = facilityStats.baki;
    }
    if (
      ringkasanFasilitas.plafon_efektif_total === 0 &&
      facilityStats.plafon > 0
    ) {
      ringkasanFasilitas.plafon_efektif_total = facilityStats.plafon;
    }

    return {
      nomor_laporan: nomorLaporan,
      tanggal_permintaan: tanggalPermintaan ?? new Date(),
      kode_ref_pengguna: kodeRefPengguna,
      operator,
      posisi_data_terakhir: posisiDataTerakhir,
      debitur_pokok: debiturPokok,
      ringkasan_fasilitas: ringkasanFasilitas,
      facilities,
      agunan,
      total_pages: pdf.pages.length,
      parse_timestamp: new Date(),
      parse_warnings: warnings,
    };
  } catch (err) {
    throw new Error(
      'Gagal membuka atau membaca PDF: ' + (err as Error).message,
    );
  } finally {
    if (pdf) {
      await pdf.close();
    }
  }
}
