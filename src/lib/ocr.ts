import Tesseract from 'tesseract.js';

export async function extractTextFromImage(
  image: File | Blob | string,
  onProgress?: (progress: number, status: string) => void
): Promise<string> {
  const result = await Tesseract.recognize(image, 'eng', {
    logger: (m) => {
      if (onProgress && typeof m.progress === 'number') {
        onProgress(Math.round(m.progress * 100), m.status || 'Recognizing text...');
      }
    },
  });
  return (result.data.text || '').trim();
}
