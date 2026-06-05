"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type CommandCtx = { open: boolean; setOpen: (o: boolean) => void; openCommand: () => void }

const Ctx = createContext<CommandCtx | null>(null)

export function CommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return <Ctx.Provider value={{ open, setOpen, openCommand: () => setOpen(true) }}>{children}</Ctx.Provider>
}

export function useCommand() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useCommand must be used within CommandProvider")
  return ctx
}
