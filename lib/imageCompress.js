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

/**
 * Resize ke lebar maksimal & encode JPEG. Kualitas diturunkan bertahap
 * sampai ukuran di bawah maxBytes.
 * @returns {Promise<{base64:string, mimeType:string, bytes:number, width:number, height:number}>}
 */
export async function compressImage(
  file,
  { maxWidth = 1280, quality = 0.82, minQuality = 0.45, maxBytes = 650_000 } = {}
) {
  const bmp = await loadBitmap(file);
  const srcW = bmp.width;
  const srcH = bmp.height;

  const encode = (width) => {
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
    let q = quality;
    let b64 = canvas.toDataURL('image/jpeg', q).split(',')[1];
    while (base64Bytes(b64) > maxBytes && q > minQuality) {
      q = Math.max(minQuality, q - 0.08);
      b64 = canvas.toDataURL('image/jpeg', q).split(',')[1];
    }
    return { b64, w, h };
  };

  // Kualitas sudah minimum tapi masih besar -> kecilkan resolusi bertahap
  let width = maxWidth;
  let out = encode(width);
  while (base64Bytes(out.b64) > maxBytes && width > 640) {
    width = Math.round(width * 0.85);
    out = encode(width);
  }
  if (typeof bmp.close === 'function') bmp.close();

  return { base64: out.b64, mimeType: 'image/jpeg', bytes: base64Bytes(out.b64), width: out.w, height: out.h };
}

/** Thumbnail kecil untuk riwayat jurnal (Supabase Storage). */
export function makeThumbnail(file) {
  return compressImage(file, { maxWidth: 360, quality: 0.6, minQuality: 0.4, maxBytes: 60_000 });
}

export function formatKB(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
