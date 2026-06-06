"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const v = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = v
    setAtBottom(v)
  }, [])

  // Stick to the bottom as content grows, but only when the user is already near it.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom()
  }, [dep, scrollToBottom])

  return { ref, atBottom, scrollToBottom, onScroll }
}
