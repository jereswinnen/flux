"use client"

import Link from "next/link"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { remarkTimestamps } from "@/lib/markdown/timestamps"
import { parseTimestamp } from "@/lib/format"

export type UIMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  sources?: { episodeId: string; episodeTitle: string; startSec: number }[] | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy"
      className="text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function ChatMessage({
  message,
  onSeek,
  pending = false,
  onEdit,
}: {
  message: UIMessage
  onSeek?: (sec: number) => void
  pending?: boolean
  onEdit?: (m: UIMessage) => void
}) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm">{message.content}</div>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(message)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Edit
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkTimestamps]}
            components={{
              a({ href, children }: { href?: string; children?: React.ReactNode }) {
                if (href?.startsWith("#t=")) {
                  const sec = parseTimestamp(String(children).replace(/[[\]]/g, ""))
                  return (
                    <button
                      type="button"
                      onClick={() => onSeek?.(Number(href.slice(3)) || sec)}
                      className="text-primary hover:underline"
                    >
                      {children}
                    </button>
                  )
                }
                return (
                  <a href={href} className="text-primary hover:underline">
                    {children}
                  </a>
                )
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : pending ? (
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
        ) : null}
      </div>

      {message.content && (
        <div className="flex items-center gap-3">
          <CopyButton text={message.content} />
          {message.sources && message.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((s, i) => (
                <Link
                  key={i}
                  href={`/episodes/${s.episodeId}?t=${s.startSec}`}
                  title={s.episodeTitle}
                  className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {s.episodeTitle.length > 24 ? `${s.episodeTitle.slice(0, 24)}…` : s.episodeTitle}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
