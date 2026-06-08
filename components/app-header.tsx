"use client"

import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export type Crumb = { label: string; href?: string }

export function AppHeader({
  breadcrumbs,
  breadcrumbMenu,
  actions,
}: {
  breadcrumbs: Crumb[]
  // Rendered as a trailing breadcrumb segment (e.g. a conversation switcher).
  breadcrumbMenu?: React.ReactNode
  // Rendered right-aligned (page actions: Play, ⋯, New chat, …).
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1 shrink-0" />
      <Separator orientation="vertical" className="mr-2 shrink-0 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {breadcrumbs.map((c, i) => {
            const isLast = i === breadcrumbs.length - 1
            // The "current" item is the last crumb (unless a menu trails it). Only
            // it shows on mobile; ancestor crumbs + separators hide to save room.
            const isCurrent = isLast && !breadcrumbMenu
            return (
              <span key={i} className="contents">
                <BreadcrumbItem className={cn("min-w-0", !isCurrent && "hidden md:flex")}>
                  {isCurrent || !c.href ? (
                    <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {(!isLast || breadcrumbMenu) && (
                  <BreadcrumbSeparator className="hidden shrink-0 md:block" />
                )}
              </span>
            )
          })}
          {breadcrumbMenu && <BreadcrumbItem className="min-w-0">{breadcrumbMenu}</BreadcrumbItem>}
        </BreadcrumbList>
      </Breadcrumb>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
