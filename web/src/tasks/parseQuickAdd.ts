// Parse a Todoist-style quick-add string into structured task fields.
// Examples: "Review specs tomorrow 5pm p1 #Eng @urgent every weekday"
export type ParsedQuickAdd = {
  title: string;
  priority?: number;          // 1..4
  dueAt?: number;             // epoch ms
  dueHasTime?: boolean;
  projectName?: string;       // from #project
  labelNames: string[];       // from @label
  recurrence?: 'daily' | 'weekday' | 'weekly' | 'monthly';
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function atTime(base: Date, h: number, m: number) { const d = new Date(base); d.setHours(h, m, 0, 0); return d; }

export function parseQuickAdd(input: string): ParsedQuickAdd {
  let text = ' ' + input.trim() + ' ';
  const labelNames: string[] = [];
  let priority: number | undefined;
  let projectName: string | undefined;
  let recurrence: ParsedQuickAdd['recurrence'];
  let dueDate: Date | undefined;
  let dueHasTime = false;

  // priority p1..p4
  text = text.replace(/\sp([1-4])\b/i, (_, p) => { priority = Number(p); return ' '; });

  // #project (single)
  text = text.replace(/\s#([^\s#@]+)/, (_, name) => { projectName = name; return ' '; });

  // @labels (multiple)
  text = text.replace(/\s@([^\s#@]+)/g, (_, name) => { labelNames.push(name); return ' '; });

  // recurrence: "every day|week|month|weekday|monday.."
  text = text.replace(/\severy\s+(day|daily|week|weekly|month|monthly|weekday|weekdays)\b/i, (_, r) => {
    const k = r.toLowerCase();
    recurrence = k.startsWith('weekday') ? 'weekday' : k.startsWith('day') || k === 'daily' ? 'daily' : k.startsWith('week') ? 'weekly' : 'monthly';
    return ' ';
  });

  const now = new Date();
  // relative day words
  text = text.replace(/\s(today|tonight|tomorrow|tmrw)\b/i, (_, w) => {
    const d = new Date(now); if (/tom|tmrw/i.test(w)) d.setDate(d.getDate() + 1);
    if (/tonight/i.test(w)) { d.setHours(20, 0, 0, 0); dueHasTime = true; }
    dueDate = d; return ' ';
  });
  // "in N days/weeks"
  text = text.replace(/\sin\s+(\d+)\s+(day|days|week|weeks)\b/i, (_, n, unit) => {
    const d = new Date(now); d.setDate(d.getDate() + Number(n) * (/week/i.test(unit) ? 7 : 1)); dueDate = d; return ' ';
  });
  // "next week"
  text = text.replace(/\snext\s+week\b/i, () => { const d = new Date(now); d.setDate(d.getDate() + 7); dueDate = d; return ' '; });
  // weekday names -> next occurrence
  text = text.replace(/\s(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, (_, w) => {
    const target = WEEKDAYS.findIndex(d => d.startsWith(w.toLowerCase()));
    if (target < 0) return ' ';
    const d = new Date(now); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add); dueDate = d; return ' ';
  });
  // explicit yyyy-mm-dd
  text = text.replace(/\s(\d{4})-(\d{2})-(\d{2})\b/, (_, y, mo, da) => { dueDate = new Date(Number(y), Number(mo) - 1, Number(da)); return ' '; });

  // time: "5pm", "5:30pm", "17:00"
  text = text.replace(/\s(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (_, h, m, ap) => {
    let hh = Number(h) % 12; if (/pm/i.test(ap)) hh += 12;
    dueDate = atTime(dueDate || now, hh, m ? Number(m) : 0); dueHasTime = true; return ' ';
  });
  text = text.replace(/\s(\d{1,2}):(\d{2})\b/, (_, h, m) => {
    dueDate = atTime(dueDate || now, Number(h), Number(m)); dueHasTime = true; return ' ';
  });

  const title = text.replace(/\s+/g, ' ').trim() || 'Untitled task';
  return { title, priority, dueAt: dueDate?.getTime(), dueHasTime, projectName, labelNames, recurrence };
}
