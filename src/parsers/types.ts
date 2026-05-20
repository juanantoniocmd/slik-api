export interface SLIKFacility {
  pelapor: string;
  pelapor_type: 'Bank' | 'Multifinance' | 'Pinjol_BNPL' | 'Lainnya';
  cabang: string;
  no_rekening: string;
  baki_debet: number;
  tanggal_update: Date | null;
  kualitas_kode: number;
  kualitas_label: string;
  kondisi: string;
  tanggal_kondisi: Date | null;
  sebab_macet: string | null;
  tanggal_macet: Date | null;
  jumlah_hari_tunggakan: number;
  frekuensi_tunggakan: number;
  tunggakan_pokok: number;
  tunggakan_bunga: number;
  denda: number;
  plafon_awal: number;
  plafon: number;
  sifat_kredit: string;
  frekuensi_restrukturisasi: number;
  cara_restrukturisasi: string;
  jenis_penggunaan: string;
  jenis_kredit: string;
  akad: string;
  suku_bunga: number;
  jenis_suku_bunga: string;
  kategori_debitur: string;
  tanggal_awal_kredit: Date | null;
  tanggal_jatuh_tempo: Date | null;
  sektor_ekonomi: string;
  kredit_program_pemerintah: boolean;
  monthly_quality_strip: Array<{ month: string; quality: number }>;
  monthly_overdue_days_strip?: Array<{ month: string; days: number | null }>;
}

export interface SLIKRingkasanFasilitas {
  plafon_efektif_total: number;
  baki_debet_total: number;
  jumlah_kreditur_bank_umum: number;
  jumlah_kreditur_bpr_bprs: number;
  jumlah_kreditur_lembaga_pembiayaan: number;
  jumlah_kreditur_lainnya: number;
  total_fasilitas: number;
  kualitas_terburuk_kode: number;
  bulan_data_terakhir: string;
}

export interface SLIKDebiturPokok {
  nama: string;
  nik: string;
  npwp: string | null;
  jenis_kelamin: string;
  tempat_lahir: string;
  tanggal_lahir: Date | null;
  pekerjaan: string;
  tempat_bekerja: string;
  bidang_usaha: string;
  alamat: string;
  kelurahan: string;
  kecamatan: string;
  kabupaten_kota: string;
  kode_pos: string;
  negara: string;
}

export interface SLIKAgunan {
  kode_register_agunan: string;
  no_rekening_fasilitas: string;
  no_cif: string;
  kode_jenis_segmen_fasilitas: string;
  kode_status_agunan: string;
  kode_jenis_agunan: string;
  kode_jenis_pengikatan: string;
  tanggal_pengikatan: Date | null;
  nama_pemilik_agunan: string;
  bukti_kepemilikan: string;
  alamat_agunan: string;
  kode_kabkota_lokasi: string;
  nilai_agunan_njop_wajar: number;
  nilai_agunan_pelapor: number;
  status_paripasu: 'Y' | 'T' | '';
  persentase_paripasu: number | null;
  status_kredit_join: 'Y' | 'T' | '';
  diasuransikan: 'Y' | 'T' | '';
  kode_kantor_cabang: string;
  operasi_data: 'C' | 'U' | 'D' | 'N' | '';
}

export interface ParsedSLIK {
  nomor_laporan: string;
  tanggal_permintaan: Date;
  kode_ref_pengguna: string;
  operator: string;
  posisi_data_terakhir: string;
  debitur_pokok: SLIKDebiturPokok[];
  ringkasan_fasilitas: SLIKRingkasanFasilitas;
  facilities: SLIKFacility[];
  agunan: SLIKAgunan[];
  total_pages: number;
  parse_timestamp: Date;
  parse_warnings: string[];
}
