import { api } from '@/lib/api';

export function formatFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function openResourceDownload(resourceId) {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  try {
    const { data } = await api.get(`/resources/${resourceId}/download-link`);
    if (!data?.signed_url) throw new Error('Download link missing');
    if (popup) popup.location.replace(data.signed_url);
    else window.open(data.signed_url, '_blank', 'noopener,noreferrer');
    return data;
  } catch (error) {
    popup?.close();
    throw error;
  }
}
