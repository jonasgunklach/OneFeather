import { useEffect, useState } from "react";
import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactInlineContentSpec } from "@blocknote/react";
import { API_BASE, apiGet, apiSend } from "../api";

// A stable color derived from a user id, so each collaborator keeps the same cursor/avatar color.
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 45%)`;
}

// @mention of an org user — rendered as a chip.
export const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      userId: { default: "" },
      name: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { userId, name } = props.inlineContent.props as { userId: string, name: string };
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            background: "#e8f0fe",
            color: "#0b57d0",
            borderRadius: "10px",
            padding: "0 6px 0 2px",
            fontWeight: 500,
            verticalAlign: "baseline",
          }}
        >
          <img
            src={`${API_BASE}/api/users/${userId}/avatar`}
            alt=""
            style={{ width: "16px", height: "16px", borderRadius: "50%", objectFit: "cover" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          @{name}
        </span>
      );
    },
  }
);

// A link to another OneFeather page. Clicking dispatches an event App listens for, to navigate.
export const PageLink = createReactInlineContentSpec(
  {
    type: "pagelink",
    propSchema: {
      nodeId: { default: "" },
      name: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <span
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("of-open-doc", { detail: props.inlineContent.props.nodeId })
          )
        }
        style={{
          background: "#e6f4ea",
          color: "#137333",
          borderRadius: "6px",
          padding: "0 4px",
          fontWeight: 500,
          cursor: "pointer",
        }}
        title="Open page"
      >
        ↗ {props.inlineContent.props.name}
      </span>
    ),
  }
);

// A live, INTERACTIVE task chip: the checkbox toggles the task (completing it everywhere it's
// embedded — page or chat), the title opens it in Tasks. Status polls so all embeds stay in sync.
export function TaskLinkChip({ taskId, fallbackTitle }: { taskId: string, fallbackTitle: string }) {
  const [task, setTask] = useState<{ title: string, status: string } | null>(null);
  const load = () => apiGet(`/api/tasks/${taskId}/summary`).then(setTask).catch(() => {});
  useEffect(() => {
    let alive = true;
    const tick = () => apiGet(`/api/tasks/${taskId}/summary`).then(t => { if (alive) setTask(t); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [taskId]);
  const done = task?.status === "done";
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTask(t => t ? { ...t, status: done ? "open" : "done" } : t); // optimistic
    await apiSend(`/api/tasks/${taskId}/${done ? "reopen" : "complete"}`, "POST");
    load();
  };
  return (
    <span
      contentEditable={false}
      style={{
        display: "inline-flex", alignItems: "center", gap: "5px",
        background: done ? "#e6f4ea" : "#fff4e5", color: done ? "#137333" : "#b06000",
        borderRadius: "10px", padding: "0 8px 0 4px", fontWeight: 500, verticalAlign: "baseline",
      }}
    >
      <span onClick={toggle} title={done ? "Mark not done" : "Mark done"} style={{ cursor: "pointer", fontSize: "13px", lineHeight: 1 }}>{done ? "☑" : "☐"}</span>
      <span onClick={() => window.dispatchEvent(new CustomEvent("of-open-task", { detail: taskId }))} title="Open task" style={{ cursor: "pointer", textDecoration: done ? "line-through" : "none" }}>{task?.title || fallbackTitle}</span>
    </span>
  );
}

export const TaskLink = createReactInlineContentSpec(
  {
    type: "tasklink",
    propSchema: { taskId: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: (props) => (
      <TaskLinkChip taskId={props.inlineContent.props.taskId} fallbackTitle={props.inlineContent.props.title} />
    ),
  }
);

// A link to a file in Drive — chip that opens the file in the viewer.
export const FileLink = createReactInlineContentSpec(
  {
    type: "filelink",
    propSchema: { nodeId: { default: "" }, name: { default: "" } },
    content: "none",
  },
  {
    render: (props) => (
      <span
        contentEditable={false}
        onClick={() => window.dispatchEvent(new CustomEvent("of-open-file", { detail: props.inlineContent.props.nodeId }))}
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#e8eaed", color: "#3c4043", borderRadius: "10px", padding: "0 8px 0 5px", fontWeight: 500, cursor: "pointer", verticalAlign: "baseline" }}
        title="Open file"
      >
        📎 {props.inlineContent.props.name}
      </span>
    ),
  }
);

// Editor schema = defaults + our custom inline content types.
export const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
    pagelink: PageLink,
    tasklink: TaskLink,
    filelink: FileLink,
  },
});

export type OFSchemaEditor = typeof schema.BlockNoteEditor;
