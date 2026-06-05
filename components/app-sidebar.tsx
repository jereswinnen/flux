"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AudioLines, Library, Plus } from "lucide-react"
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
} from "@/components/ui/sidebar"
import { useCommand } from "@/components/command-context"
import { ThemeToggle } from "@/components/theme-toggle"

type RecentEpisode = { id: string; title: string; artworkUrl: string | null }

export function AppSidebar() {
  const pathname = usePathname()
  const { openCommand } = useCommand()
  const [recent, setRecent] = useState<RecentEpisode[]>([])

  useEffect(() => {
    let active = true
    fetch("/api/episodes")
      .then((r) => r.json())
      .then((d) => { if (active) setRecent((d.episodes ?? []).slice(0, 6)) })
      .catch(() => {})
    return () => { active = false }
  }, [pathname])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
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
              <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Library">
                <Link href="/"><Library className="size-4" /><span>Library</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={openCommand} tooltip="Add episode (⌘K)">
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
                  <SidebarMenuButton asChild isActive={pathname === `/episodes/${e.id}`} tooltip={e.title}>
                    <Link href={`/episodes/${e.id}`}>
                      {e.artworkUrl ? (
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
