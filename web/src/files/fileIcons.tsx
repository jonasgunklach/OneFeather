import { Folder as FolderIcon, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode, FileSpreadsheet, FileType, File as FileIconBase } from 'lucide-react';

export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

export function fileKind(mime?: string, name?: string): FileKind {
  const m = (mime || '').toLowerCase();
  const ext = (name?.split('.').pop() || '').toLowerCase();
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (m.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'log', 'xml', 'yml', 'yaml', 'js', 'ts', 'tsx', 'jsx', 'py', 'css', 'html', 'sh'].includes(ext)) return 'text';
  return 'other';
}

// Returns the lucide icon component + a color for a file/node.
export function iconFor(node: { type: string, mimeType?: string, name?: string }, theme: 'light' | 'dark') {
  const folderColor = theme === 'dark' ? '#b5b8bc' : '#444746';
  if (node.type === 'drive') return { Icon: FolderIcon, color: theme === 'dark' ? '#e3e3e3' : '#1f1f1f', fill: true };
  if (node.type === 'folder') return { Icon: FolderIcon, color: folderColor, fill: true };
  if (node.type === 'document') return { Icon: FileText, color: '#0b57d0', fill: false };

  const ext = (node.name?.split('.').pop() || '').toLowerCase();
  const m = (node.mimeType || '').toLowerCase();
  const kind = fileKind(node.mimeType, node.name);
  if (kind === 'image') return { Icon: FileImage, color: '#1e8e3e', fill: false };
  if (kind === 'pdf') return { Icon: FileType, color: '#d93025', fill: false };
  if (kind === 'video') return { Icon: FileVideo, color: '#c5221f', fill: false };
  if (kind === 'audio') return { Icon: FileAudio, color: '#9334e6', fill: false };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || m.includes('zip') || m.includes('compressed')) return { Icon: FileArchive, color: '#a8732b', fill: false };
  if (['csv', 'xls', 'xlsx'].includes(ext) || m.includes('spreadsheet') || m.includes('excel')) return { Icon: FileSpreadsheet, color: '#1e8e3e', fill: false };
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sh', 'xml', 'yml', 'yaml'].includes(ext)) return { Icon: FileCode, color: '#1a73e8', fill: false };
  if (kind === 'text') return { Icon: FileText, color: theme === 'dark' ? '#9aa0a6' : '#5f6368', fill: false };
  return { Icon: FileIconBase, color: theme === 'dark' ? '#9aa0a6' : '#5f6368', fill: false };
}

export function formatBytes(n?: number) {
  if (n == null) return '—';
  if (n === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
