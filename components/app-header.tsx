"use client"

import { Command } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useCommand } from "@/components/command-context"

export type Crumb = { label: string; href?: string }

export function AppHeader({ breadcrumbs }: { breadcrumbs: Crumb[] }) {
  const { openCommand } = useCommand()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1
            return (
              <span key={i} className="contents">
                <BreadcrumbItem>
                  {last || !c.href ? (
                    <BreadcrumbPage className="max-w-[40ch] truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator />}
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <Button variant="outline" size="sm" className="ml-auto gap-2 text-muted-foreground" onClick={openCommand}>
        <Command className="size-3.5" />
        <span className="hidden sm:inline">Add episode</span>
        <kbd className="hidden rounded bg-muted px-1.5 text-[10px] sm:inline">⌘K</kbd>
      </Button>
    </header>
  )
}
