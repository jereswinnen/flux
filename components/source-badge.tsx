export function SourceBadge({ kind }: { kind: "highlight" | "web" }) {
  const cls =
    kind === "web"
      ? "shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400"
      : "shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-primary"
  return <span className={cls}>{kind === "web" ? "Web" : "Highlight"}</span>
}
