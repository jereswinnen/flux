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

export type Crumb = { label: string; href?: string }

export function AppHeader({ breadcrumbs }: { breadcrumbs: Crumb[] }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b px-4">
      <SidebarTrigger className="-ml-1 shrink-0" />
      <Separator orientation="vertical" className="mr-2 shrink-0 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1
            return (
              <span key={i} className="contents">
                <BreadcrumbItem className="min-w-0">
                  {last || !c.href ? (
                    <BreadcrumbPage className="max-w-[55vw] truncate sm:max-w-[40ch]">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator className="shrink-0" />}
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  )
}
