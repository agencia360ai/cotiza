function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };
    img.src = url;
  });
}

type CompressOptions = {
  maxDimension?: number;
  quality?: number;
  maxBytes?: number;
};

/**
 * Browser-side image compression. Downscales large iPhone/Android photos
 * before upload so they're not 4-12 MB on cellular. No-op on non-image
 * files, files already small, or in non-browser contexts.
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxDimension = 1600, quality = 0.85, maxBytes = 500 * 1024 } = options;

  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= maxBytes) return file;

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const longest = Math.max(img.width, img.height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return file;

  // If the result is somehow bigger than the original, return original
  if (blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, ".jpg") || "foto.jpg";
  return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
}
