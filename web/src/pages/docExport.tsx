import { PDFExporter, pdfDefaultSchemaMappings } from '@blocknote/xl-pdf-exporter';
import { DOCXExporter, docxDefaultSchemaMappings } from '@blocknote/xl-docx-exporter';
import { Text, pdf } from '@react-pdf/renderer';
import { TextRun } from 'docx';

function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}

// Our custom inline content (mention/pagelink/filelink/tasklink) isn't in the default export
// mappings — render each as plain text so PDF/DOCX export doesn't fail.
const pdfMappings: any = {
  ...pdfDefaultSchemaMappings,
  inlineContentMapping: {
    ...pdfDefaultSchemaMappings.inlineContentMapping,
    mention: (ic: any) => <Text>@{ic.props.name}</Text>,
    pagelink: (ic: any) => <Text>{ic.props.name}</Text>,
    filelink: (ic: any) => <Text>{ic.props.name}</Text>,
    tasklink: (ic: any) => <Text>{ic.props.title}</Text>,
  },
};
const docxMappings: any = {
  ...docxDefaultSchemaMappings,
  inlineContentMapping: {
    ...docxDefaultSchemaMappings.inlineContentMapping,
    mention: (ic: any) => new TextRun('@' + ic.props.name),
    pagelink: (ic: any) => new TextRun(ic.props.name),
    filelink: (ic: any) => new TextRun(ic.props.name),
    tasklink: (ic: any) => new TextRun(ic.props.title),
  },
};

export async function exportDoc(editor: any, format: 'pdf' | 'docx' | 'md' | 'html', name: string) {
  const base = (name || 'document').replace(/[\/\\:*?"<>|]/g, '_');
  if (format === 'md') {
    const md = await editor.blocksToMarkdownLossy();
    return download(new Blob([md], { type: 'text/markdown' }), `${base}.md`);
  }
  if (format === 'html') {
    const html = await editor.blocksToFullHTML();
    return download(new Blob([`<!doctype html><meta charset="utf-8"><title>${base}</title>${html}`], { type: 'text/html' }), `${base}.html`);
  }
  if (format === 'pdf') {
    const ex = new PDFExporter(editor.schema, pdfMappings);
    const reactPdfDoc = await ex.toReactPDFDocument(editor.document);
    const blob = await pdf(reactPdfDoc as any).toBlob();
    return download(blob, `${base}.pdf`);
  }
  if (format === 'docx') {
    const ex = new DOCXExporter(editor.schema, docxMappings);
    const blob = await ex.toBlob(editor.document);
    return download(blob, `${base}.docx`);
  }
}
