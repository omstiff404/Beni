/**
 * BENIMARU — Vercel Serverless Function
 * ---------------------------------------------------------
 * File ini otomatis menjadi endpoint: https://domain-kamu.vercel.app/api/chat
 * (Vercel mengubah setiap file di folder /api menjadi endpoint serverless
 * secara otomatis — tidak perlu app.listen() seperti server Express biasa.)
 *
 * SET API KEY DI VERCEL:
 * 1. Buka project kamu di vercel.com -> tab "Settings" -> "Environment Variables".
 * 2. Tambah: Name = GROQ_API_KEY, Value = key Groq asli kamu (gsk_...).
 * 3. Pilih semua environment (Production, Preview, Development) -> Save.
 * 4. Redeploy project (Vercel akan minta redeploy otomatis setelah env var ditambah).
 *
 * TESTING LOKAL dengan Vercel CLI ("vercel dev"):
 * Buat file .env di root project berisi: GROQ_API_KEY=gsk_xxxxxxxx
 * (jangan sampai file .env ini ikut ter-upload ke GitHub publik).
 */

const ALLOWED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'deepseek-r1-distill-llama-70b',
  'gemma2-9b-it'
];

// Rate-limit sederhana (best-effort — instance Vercel bisa berganti-ganti,
// jadi ini bukan jaminan mutlak. Untuk publik ramai, pertimbangkan Vercel
// Firewall / Rate Limiting di dashboard untuk perlindungan yang konsisten).
const hits = new Map();
function isRateLimited(ip, limitPerMinute) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limitPerMinute;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip, 15)) {
    return res.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi sebentar.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY belum diset di Environment Variables Vercel.' });
  }

  const body = req.body || {};
  const model = ALLOWED_MODELS.includes(body.model) ? body.model : 'llama-3.3-70b-versatile';
  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.7;
  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : [];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({ model, temperature, stream: true, messages })
    });

    res.status(groqRes.status);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    for await (const chunk of groqRes.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghubungi Groq: ' + err.message });
  }
};
