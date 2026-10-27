export function downloadBlob(data, filename, fallbackType) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: fallbackType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function filenameFromDisposition(headers, fallback) {
  const disposition = headers?.['content-disposition'] || '';
  return disposition.match(/filename="([^"]+)"/)?.[1] || fallback;
}
