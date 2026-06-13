"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AudioLines, Highlighter, Library, Loader2, Plus, Sparkles } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useCommand } from "@/components/command-context"
import { ThemeToggle } from "@/components/theme-toggle"

type RecentItem = { id: string; title: string; artworkUrl: string | null; status: string }

export function AppSidebar() {
  const pathname = usePathname()
  const { openCommand } = useCommand()
  const { setOpenMobile } = useSidebar()
  // Close the mobile sidebar sheet on any navigation/action (no-op on desktop).
  const close = () => setOpenMobile(false)
  const [recent, setRecent] = useState<RecentItem[]>([])

  useEffect(() => {
    let active = true
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) => { if (active) setRecent((d.items ?? []).slice(0, 6)) })
      .catch(() => {})
    return () => { active = false }
  }, [pathname])

  // While anything is processing, poll so the spinner clears once it's ready.
  const anyInFlight = recent.some((e) => !["ready", "failed"].includes(e.status))
  useEffect(() => {
    if (!anyInFlight) return
    const t = setInterval(() => {
      fetch("/api/items")
        .then((r) => r.json())
        .then((d) => setRecent((d.items ?? []).slice(0, 6)))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [anyInFlight])

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" onClick={close}>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <AudioLines className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Podcast KB</span>
                  <span className="truncate text-xs text-muted-foreground">Knowledge base</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Library" onClick={close}>
                <Link href="/"><Library className="size-4" /><span>Library</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/ask"} tooltip="Ask your library" onClick={close}>
                <Link href="/ask"><Sparkles className="size-4" /><span>Ask</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/highlights"} tooltip="Highlights" onClick={close}>
                <Link href="/highlights"><Highlighter className="size-4" /><span>Highlights</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => { close(); openCommand() }} tooltip="Add to library (⌘K)">
                <Plus className="size-4" /><span>Add episode</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {recent.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarMenu>
              {recent.map((e) => (
                <SidebarMenuItem key={e.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/items/${e.id}`} tooltip={e.title} onClick={close}>
                    <Link href={`/items/${e.id}`}>
                      {!["ready", "failed"].includes(e.status) ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : e.artworkUrl ? (
                        <img src={e.artworkUrl} alt="" className="size-4 rounded-sm object-cover" />
                      ) : (
                        <div className="size-4 rounded-sm bg-muted" />
                      )}
                      <span className="truncate">{e.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
