# LineLens — Riset Domain OEE/Manufacturing Analytics

**Tanggal:** 2026-07-22 · **Metode:** deep-research adversarial (106 agent; 24 sumber di-fetch; 109 klaim diekstrak; 25 diverifikasi 3-suara → 21 terkonfirmasi, 4 terbantah) + riset lanjutan terarah untuk 2 celah (DDS, DIFOT).
**Status nama:** "LineLens" masih kandidat kerja, belum final.

---

## 1. Ringkasan eksekutif

Riset memvalidasi fondasi teknis MVP pada 5 dari 7 pertanyaan riset dengan konfidensi tinggi (semua suara verifikasi 3-0). Dua pertanyaan kunci (DIFOT→OEE sebagai diferensiator; isi papan DDS) tidak lolos putaran verifikasi adversarial karena budget, lalu ditutup dengan riset terarah bertingkat-konfidensi-lebih-rendah (ditandai eksplisit di §5–6).

**Kesimpulan terpenting untuk positioning:** drill-down OEE→DIFOT **tidak ditemukan** pada produk segmen OEE (Vorne/Evocon/MachineMetrics berhenti di mesin), dan pemain terdekat (Celonis) bekerja dari data proses ERP, bukan telemetri mesin. Tapi klaim "belum ada yang melakukan ini" TIDAK boleh dipakai di materi porto — belum tervalidasi menyeluruh (MES/ERP suite besar menghubungkan secara tidak langsung via schedule attainment). Framing aman: **"Tool OEE berhenti di mesin; analitik supply-chain mulai dari order; LineLens mendemonstrasikan jembatannya dalam satu drill-down."**

---

## 2. Fondasi perhitungan OEE (terverifikasi 3-0)

**Formula yang diadopsi — "preferred calculation":**

```
OEE = Availability × Performance × Quality
Availability = Run Time / Planned Production Time
Performance  = (Ideal Cycle Time × Total Count) / Run Time
Quality      = Good Count / Total Count
```

Varian TEEP/OOE hanya mengubah denominator availability (calendar time), bukan struktur formula. ([oee.com/calculating-oee](https://www.oee.com/calculating-oee/), [machinemetrics.com](https://www.machinemetrics.com/blog/oee-ooe-teep))

**Ideal Cycle Time (ICT):** waktu siklus *tercepat teoretis* dalam kondisi optimal — bukan angka budget/standar. **Aturan validasi wajib di dashboard & simulator: Performance > 100% = ICT di-set salah.** Debat lapangan hanya soal metode kalibrasi (nameplate vs best demonstrated rate). ([oee.com](https://www.oee.com/calculating-oee/))

**Changeover & planned vs unplanned:**
- Changeover/setup/planned maintenance = Planned Stop yang **tetap dihitung availability loss** (kategori Setup & Adjustments — biasanya komponen terbesar; SMED = metode perbaikan standarnya).
- Yang dikecualikan dari Planned Production Time hanya break dan waktu tanpa niat produksi (Schedule Loss).
- Best practice: planned stop yang melewati target waktunya **bertransisi menjadi unplanned** agar overage terlihat (Vorne; dikorroborasi independen Mingo & TeepTrak).
- Sebagian pabrik mengecualikan changeover → jadikan **kebijakan configurable** di LineLens.

**Benchmark:**
- World-class 85% berasal dari Nakajima, *Introduction to TPM* (1984; ed. Inggris 1988), dekomposisi **90% A × 95% P × 99% Q**. Sumber kanonik sendiri membingkainya sebagai "conventional belief", bukan target universal (Arno Koch: angka komponen konteks machine-shop). Narasi demo yang kuat: rugi Availability (10%) = 2× rugi Performance dan 10× rugi Quality → **menurunkan downtime adalah jalur tercepat menaikkan OEE**.
- Realitas lapangan: kebanyakan pabrik ±60%; **lebih banyak yang <45% daripada >85%** (observasi Vorne; dikorroborasi dataset Evocon: 3.500+ mesin, 50+ negara, puncak distribusi 55–60%, hanya ~6% organisasi mencapai 85%+). ([oee.com/world-class-oee](https://www.oee.com/world-class-oee/), [evocon.com](https://evocon.com/articles/world-class-oee-industry-benchmarks-from-more-than-50-countries/))

---

## 3. Six Big Losses (terverifikasi 3-0)

Pemetaan berpasangan 2-2-2 ke faktor OEE (asal TPM/Nakajima; konfirmasi independen TeepTrak, Evocon, Intelycx):

| Faktor OEE | Loss klasik | Versi modern (Vorne) |
|---|---|---|
| Availability | Equipment Failure | Unplanned Stops |
| Availability | Setup & Adjustments | Planned Stops |
| Performance | Idling & Minor Stops | Small Stops |
| Performance | Reduced Speed | Slow Cycles |
| Quality | Process Defects | Production Rejects |
| Quality | Reduced Yield | Startup Rejects |

**Edge case krusial untuk state machine simulator:** small stops (biasanya <5 menit, diselesaikan operator tanpa maintenance — misfeed, material jam, sensor terhalang) = **rugi Performance, BUKAN Availability**. ([oee.com/oee-six-big-losses](https://www.oee.com/oee-six-big-losses/), [vorne.com](https://www.vorne.com/learn/downtime/machine-downtime-tracking-and-reporting/))

---

## 4. Lanskap kompetitor & baseline UX (terverifikasi)

**Arsitektur data Vorne XL** (appliance edge pemimpin pasar): cukup **1–2 sensor diskrit** (photo-eye/proximity/relay/output PLC) untuk sinyal count/cycle → derive 140+ metrik. **Reason code downtime/reject datang dari input operator, bukan sensor** → simulator LineLens harus memodelkan anotasi alasan ala operator, bukan sensor kompleks. ([vorne.com/products/xl](https://www.vorne.com/products/xl/))

**Pola UX baseline yang harus ada di MVP** (tervalidasi lintas komersial + open-source):
1. Pareto downtime per reason, stackable per shift
2. Top Losses report dalam kerangka Six Big Losses
3. Timeline produksi berkode warna
4. Scoreboard real-time lantai pabrik
5. Andon digital + push alert — **isi minimum per lini: production state (Running/Down/Changeover/Break) + good count + target count**
6. Dashboard kustom dari kombinasi visualisasi pre-built

**Preseden open-source:** Libre (Spruik, Apache 2.0) = Grafana + InfluxDB + PostgreSQL; pola sama (Pareto downtime + sunburst durasi/frekuensi). **Dormant sejak Maret 2022** (penerus: LibreMfg/Rhize) → kutip sebagai preseden arsitektur, bukan opsi aktif. ([github.com/Spruik/Libre](https://github.com/Spruik/Libre))

---

## 5. DIFOT/OTIF & status diferensiator *(riset lanjutan terarah — konfidensi lebih rendah, bukan hasil verifikasi adversarial)*

- OTIF/DIFOT lazim sebagai **KPI supply-chain** di dashboard KPI manufaktur (muncul sebagai tile bersama OEE, schedule attainment, first-pass yield — [ifactoryapp KPI template](https://ifactoryapp.com/analytics-reporting/manufacturing-kpi-dashboard-template-2026)) — tapi sebagai angka agregat, bukan drill-down kausal.
- **Pemain terdekat: Celonis** — process mining membangun view real-time semua order dan mengklasifikasikan delay — namun dari **data proses ERP, bukan telemetri mesin** ([celonis.com](https://www.celonis.com/blog/otif-explained-the-what-why-and-how-of-optimizing-for-on-time-in-full-delivery)).
- Tool segmen OEE (Vorne/Evocon/MachineMetrics) menghubungkan OEE ke throughput secara **naratif**, tidak ke order pelanggan spesifik.
- **Verdict:** drill-down "order telat → loss event mesin" tidak ditemukan di segmen OEE standalone → diferensiator **plausible dan layak dibangun**, tapi di materi porto pakai framing jembatan (§1), **jangan klaim keunikan absolut**.

---

## 6. Daily Direction Setting *(riset lanjutan terarah — sumber utama Augmentir, single-source)*

- Meeting **10–15 menit**, terstruktur, harian.
- Peserta: line operators, maintenance, quality, supervisors.
- Agenda: review performa kemarin (**safety, quality, production**) vs target · KPI (OEE, downtime) · goals & prioritas hari ini · update staffing/equipment/material · safety reminders · eskalasi isu + action plans.
- Board: performance board / Gemba board, fisik atau digital. ([augmentir.ai](https://www.augmentir.ai/glossary/daily-direction-setting))

**Spek layar DDS LineLens:** (a) ringkasan kemarin — safety/quality/delivery + OEE + top loss; (b) top-3 aksi hari ini dengan owner; (c) status eskalasi. Struktur tiering meeting (shift→line→plant) tidak terdokumentasi di sumber — jangan diklaim spesifik IWS/P&G.

---

## 7. Standar telemetri untuk simulator (terverifikasi)

- **PackML (ISA-TR88.00.02 / OMAC):** inti = **PackTags** dalam 3 kategori — Command (interaksi state machine), Status (state mesin), Admin (alarm, alarm history, statistik). Simulator kredibel me-mirror minimal subset **Status + Admin** (state, counts, cycle time, alarms). ([OPC Foundation](https://reference.opcfoundation.org/PackML/v101/docs/4))
- **Sparkplug B (Eclipse 3.0 / ISO-IEC 20237):** namespace topik `spBv1.0/<Group ID>/<MESSAGE TYPE>/<Edge Node ID>/<Device ID>`; Device ID hanya di pesan level device (DBIRTH/DDATA/DCMD); STATE memakai bentuk berbeda. ([HiveMQ](https://www.hivemq.com/resources/smart-manufacturing-using-isa95-mqtt-sparkplug-and-uns/), Eclipse Sparkplug Spec 3.0.0)
- **Pola UNS:** path hierarkis diletakkan di **nama metrik dalam payload** (mis. `Site/Area/Line/Cell`), bukan di topik MQTT (yang fixed 4-level) — konvensi industri populer, bukan standar formal.

---

## 8. Anti-patterns — 4 klaim TERBANTAH oleh verifikasi (0-3 / 1-2)

1. **"Enterprise/Site/Area/Line/Cell adalah hierarki ISA-95"** — SALAH. Normatif ISA-95: Enterprise/Site/Area/**Work Center/Work Unit**; "Line/Cell" = konvensi UNS. Di dokumentasi tulis **"UNS-style hierarchy"**, jangan "ISA-95-aligned".
2. **Threshold 2 menit untuk membedakan minor stop vs breakdown** — tidak berdasar; tidak ada batas normatif universal (lapangan bervariasi 2–10 menit). Jadikan configurable.
3. **Daftar state PackML dari halaman OPC Section 4 saja** — tidak lengkap; enumerasi state wajib dirujuk langsung dari ISA-TR88.00.02-2015 sebelum implementasi. (Referensi komunitas Beckhoff: 17 state; minimal compliant 4 — Aborted/Stopped/Idle/Execute — *belum diverifikasi adversarial, cek ISA-TR88 langsung*.)
4. **"OEE adalah objective eksplisit PackML"** — tidak terbukti; PackML soal interoperabilitas state/tag, bukan OEE.

---

## 9. Rekomendasi desain konkret MVP (sintesis dari 21 klaim terverifikasi)

**ADOPSI:**
- Preferred calculation A×P×Q; ICT sebagai parameter per mesin; validasi built-in Performance ≤ 100%.
- Six Big Losses versi Vorne; small stops→Performance, changeover→Availability; kebijakan configurable "changeover as planned" + transisi planned→unplanned saat overage.
- Telemetri ala Vorne XL: stream count/reject/cycle diskrit + reason code teranotasi (meniru input operator).
- PackTags-lite (Status+Admin) di payload; topik gaya Sparkplug B `spBv1.0/LineLens/<type>/<line>/<machine>`; path hierarkis di nama metrik (UNS-style).
- UX MVP: waterfall A×P×Q · Pareto Top Losses stackable per shift · timeline produksi berwarna · andon per lini (state+good+target) · layar DDS (§6).
- Kalibrasi distribusi simulator: mayoritas lini **50–65%** OEE, satu lini showcase **~85%**, satu lini bermasalah **<45%** → cerita perbaikan yang realistis.

**SEDERHANAKAN:**
- Tidak perlu full Sparkplug protobuf + birth/death lifecycle — cukup konvensi topik + JSON payload.
- State machine PackML → subset state terverifikasi dari ISA-TR88.
- MTBF/MTTR & pola shift: parameter configurable dengan default masuk akal (angka per-kelas-mesin tidak ditemukan di riset — jangan hardcode klaim).

**DIFERENSIATOR:** modul OEE→DIFOT dibangun sebagai jembatan mesin→order; framing porto per §1 (tanpa klaim keunikan absolut).

---

## 10. Open questions (untuk riset/keputusan berikutnya)

1. Subset state PackML minimal — verifikasi langsung dari ISA-TR88.00.02-2015.
2. MTBF/MTTR tipikal per kelas mesin (packaging/filling/molding) untuk kalibrasi distribusi downtime.
3. Pola shift manufaktur Indonesia (2 vs 3 shift, istirahat, Jumat) untuk kalender simulator.
4. Sweep lanjutan MES/ERP suite (SAP DM, Plex app store, Tulip marketplace) sebelum finalisasi kalimat positioning di case study.

## Catatan sumber

Dominasi ekosistem Vorne (oee.com + vorne.com) pada klaim metodologi — de-facto referensi industri dan terkorroborasi kompetitor (Evocon, TeepTrak, Mingo), tapi tetap vendor; angka distribusi 45/85% = observasi basis pelanggan, bukan survei netral. Angka fitur vendor (140+ metrik, 64+ report) time-sensitive per Juli 2026.
