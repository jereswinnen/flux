import { visit } from "unist-util-visit"
import { parseTimestamp } from "@/lib/format"

const RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

// Pure: split a text string into mdast nodes, linkifying [m:ss]; null if no match.
export function splitTimestamps(value: string): MdNode[] | null {
  if (!RE.test(value)) return null
  RE.lastIndex = 0
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) })
    const ts = m[1]
    out.push({
      type: "link",
      url: `#t=${parseTimestamp(ts)}`,
      children: [{ type: "text", value: `[${ts}]` }],
    })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) })
  return out
}

// Remark plugin using the pure splitter above.
export function remarkTimestamps() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: MdNode) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree as any, "text", (node: MdNode, index: number | undefined, parent: MdNode | null) => {
      if (!parent || index == null || !node.value) return
      const replacement = splitTimestamps(node.value)
      if (!replacement) return
      parent.children!.splice(index, 1, ...replacement)
      return index + replacement.length
    })
  }
}
