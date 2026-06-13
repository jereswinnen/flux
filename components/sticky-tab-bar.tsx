import type { ReactNode } from "react"

export function StickyTabBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
      {children}
    </div>
  )
}
