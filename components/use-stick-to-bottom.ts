"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])

  useEffect(() => {
    if (atBottom) scrollToBottom()
  }, [dep, atBottom, scrollToBottom])

  return { ref, atBottom, scrollToBottom, onScroll }
}
