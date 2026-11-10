/** Convert a user image to a small white-backed black/white PNG for XP-80.
 * This is a browser-only helper. DB stores the validated PNG, never remote URLs.
 */
export async function prepareThermalImage(file: File): Promise<{ png: File; dataUri: string }> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('اختر صورة PNG أو JPG أو WebP');
  if (file.size > 8 * 1024 * 1024) throw new Error('الصورة الأصلية أكبر من 8MB');
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 576 / bitmap.width, 1200 / bitmap.height);
    let width = Math.max(1, Math.round(bitmap.width * ratio));
    let height = Math.max(1, Math.round(bitmap.height * ratio));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('تعذر تجهيز الصورة');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      // Match local ESC/POS's grayscale <170 threshold so screen and paper agree.
      for (let i = 0; i < image.data.length; i += 4) {
        const gray = image.data[i] * .299 + image.data[i+1] * .587 + image.data[i+2] * .114;
        const color = gray < 170 ? 0 : 255;
        image.data[i] = color;
        image.data[i+1] = color;
        image.data[i+2] = color;
        image.data[i+3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('فشل تحويل الصورة إلى PNG');
      if (blob.size <= 153600) {
        const png = new File([blob], 'receipt-decoration.png', { type: 'image/png' });
        const dataUri = canvas.toDataURL('image/png');
        return { png, dataUri };
      }
      width = Math.max(1, Math.round(width * .7));
      height = Math.max(1, Math.round(height * .7));
    }
    throw new Error('تعذر ضغط الصورة لأقل من 150KB');
  } finally {
    bitmap.close();
  }
}
