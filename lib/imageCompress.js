// Kompresi gambar di browser sebelum dikirim ke API.
// Tujuan: total payload jauh di bawah limit 4.5MB Vercel.

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fallback ke <img> */
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Gagal membaca gambar: ${file.name}`));
    };
    img.src = url;
  });
}

function base64Bytes(b64) {
  return Math.floor((b64.length * 3) / 4);
}

const dataUrlParts = (url) => {
  const [head, b64] = url.split(',');
  return { mime: (/data:([^;]+)/.exec(head) || [])[1] || 'image/png', b64 };
};

/**
 * Resize ke lebar maksimal lalu encode. Urutan: PNG (lossless) -> WebP lossless (Chrome/Android)
 * -> JPEG kualitas tinggi -> JPEG diturunkan bertahap -> resolusi dikecilkan.
 * Screenshot chart berisi angka kecil di sumbu harga; artefak JPEG membuat AI salah baca angka,
 * jadi format lossless selalu dicoba lebih dulu.
 * @returns {Promise<{base64:string, mimeType:string, bytes:number, width:number, height:number, lossless:boolean}>}
 */
export async function compressImage(
  file,
  { maxWidth = 1280, quality = 0.92, minQuality = 0.72, maxBytes = 650_000, lossless = true, minWidth = 900 } = {}
) {
  const bmp = await loadBitmap(file);
  const srcW = bmp.width;
  const srcH = bmp.height;

  const draw = (width) => {
    const scale = srcW > width ? width / srcW : 1;
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // latar gelap agar PNG transparan tidak jadi hitam aneh/putih
    ctx.fillStyle = '#0B0E11';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    return { canvas, w, h };
  };

  const encode = (width) => {
    const { canvas, w, h } = draw(width);
    if (lossless) {
      const png = dataUrlParts(canvas.toDataURL('image/png'));
      if (base64Bytes(png.b64) <= maxBytes) return { ...png, w, h, lossless: true };
      // WebP quality 1 = lossless di Chrome; Safari tidak mendukung encode WebP (mengembalikan PNG) -> dilewati
      const webp = dataUrlParts(canvas.toDataURL('image/webp', 1));
      if (webp.mime === 'image/webp' && base64Bytes(webp.b64) <= maxBytes) return { ...webp, w, h, lossless: true };
    }
    let q = quality;
    let jpg = dataUrlParts(canvas.toDataURL('image/jpeg', q));
    while (base64Bytes(jpg.b64) > maxBytes && q > minQuality) {
      q = Math.max(minQuality, q - 0.05);
      jpg = dataUrlParts(canvas.toDataURL('image/jpeg', q));
    }
    return { ...jpg, mime: 'image/jpeg', w, h, lossless: false };
  };

  // Masih terlalu besar -> kecilkan resolusi bertahap (tidak di bawah minWidth agar angka tetap terbaca)
  let width = maxWidth;
  let out = encode(width);
  while (base64Bytes(out.b64) > maxBytes && width > minWidth) {
    width = Math.max(minWidth, Math.round(width * 0.85));
    out = encode(width);
  }
  // Upaya terakhir (banyak gambar): JPEG kualitas lebih rendah di minWidth agar total payload tetap muat
  if (base64Bytes(out.b64) > maxBytes && !out.lossless) {
    const { canvas, w, h } = draw(width);
    let q = minQuality;
    let jpg = dataUrlParts(canvas.toDataURL('image/jpeg', q));
    while (base64Bytes(jpg.b64) > maxBytes && q > 0.5) {
      q = Math.max(0.5, q - 0.05);
      jpg = dataUrlParts(canvas.toDataURL('image/jpeg', q));
    }
    out = { ...jpg, mime: 'image/jpeg', w, h, lossless: false };
  }
  if (typeof bmp.close === 'function') bmp.close();

  return { base64: out.b64, mimeType: out.mime, bytes: base64Bytes(out.b64), width: out.w, height: out.h, lossless: out.lossless };
}

/** Thumbnail kecil untuk riwayat jurnal (Supabase Storage). */
export function makeThumbnail(file) {
  return compressImage(file, { maxWidth: 360, quality: 0.6, minQuality: 0.4, maxBytes: 60_000, lossless: false, minWidth: 240 });
}

export function formatKB(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
