// Predefined page templates (Notion/Affine-style). Block arrays seeded into a new doc.
// `content` as a plain string is BlockNote shorthand for a single text run.

export type Template = { id: string, name: string, icon: string, description: string, blocks: any[] };

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank page', icon: '📄', description: 'Start from scratch.', blocks: [] },
  {
    id: 'meeting', name: 'Meeting notes', icon: '🗓️', description: 'Agenda, notes, action items.',
    blocks: [
      { type: 'heading', props: { level: 1 }, content: 'Meeting notes' },
      { type: 'paragraph', content: 'Date · Attendees · ' },
      { type: 'heading', props: { level: 2 }, content: 'Agenda' },
      { type: 'bulletListItem', content: 'Topic 1' },
      { type: 'bulletListItem', content: 'Topic 2' },
      { type: 'heading', props: { level: 2 }, content: 'Notes' },
      { type: 'paragraph', content: '' },
      { type: 'heading', props: { level: 2 }, content: 'Action items' },
      { type: 'checkListItem', content: 'Follow up on …' },
    ],
  },
  {
    id: 'prd', name: 'Project brief / PRD', icon: '🚀', description: 'Problem, goals, scope, plan.',
    blocks: [
      { type: 'heading', props: { level: 1 }, content: 'Project brief' },
      { type: 'heading', props: { level: 2 }, content: 'Problem' },
      { type: 'paragraph', content: 'What are we solving and for whom?' },
      { type: 'heading', props: { level: 2 }, content: 'Goals & success metrics' },
      { type: 'bulletListItem', content: 'Goal …' },
      { type: 'heading', props: { level: 2 }, content: 'Scope' },
      { type: 'paragraph', content: 'In scope / out of scope.' },
      { type: 'heading', props: { level: 2 }, content: 'Milestones' },
      { type: 'checkListItem', content: 'Milestone 1' },
    ],
  },
  {
    id: 'weekly', name: 'Weekly review', icon: '📝', description: 'Wins, blockers, next week.',
    blocks: [
      { type: 'heading', props: { level: 1 }, content: 'Weekly review' },
      { type: 'heading', props: { level: 2 }, content: 'Wins' },
      { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 2 }, content: 'Blockers' },
      { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 2 }, content: 'Next week' },
      { type: 'checkListItem', content: '' },
    ],
  },
  {
    id: 'todo', name: 'To-do list', icon: '✅', description: 'A simple checklist.',
    blocks: [
      { type: 'heading', props: { level: 1 }, content: 'To-do' },
      { type: 'checkListItem', content: '' },
      { type: 'checkListItem', content: '' },
      { type: 'checkListItem', content: '' },
    ],
  },
  {
    id: 'brainstorm', name: 'Brainstorm', icon: '💡', description: 'Capture and group ideas.',
    blocks: [
      { type: 'heading', props: { level: 1 }, content: 'Brainstorm' },
      { type: 'paragraph', content: 'Topic: ' },
      { type: 'heading', props: { level: 2 }, content: 'Ideas' },
      { type: 'bulletListItem', content: '' },
      { type: 'heading', props: { level: 2 }, content: 'Top picks' },
      { type: 'bulletListItem', content: '' },
    ],
  },
];

// Hand a template to the editor that's about to open a freshly-created doc.
const pending = new Map<string, any[]>();
export function setPendingTemplate(docId: string, blocks: any[]) { if (blocks.length) pending.set(docId, blocks); }
export function takePendingTemplate(docId: string): any[] | null { const b = pending.get(docId); if (b) { pending.delete(docId); return b; } return null; }
