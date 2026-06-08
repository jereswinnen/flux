import { Geist_Mono, Figtree, DM_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import { CommandProvider } from "@/components/command-context"
import { AddCommand } from "@/components/add-command"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PlayerProvider } from "@/components/player-context"
import { GlobalPlayer } from "@/components/global-player"

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'})
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", dmSans.variable)}
    >
      <body>
        <ThemeProvider>
          <CommandProvider>
            <PlayerProvider>
              <TooltipProvider>
                <SidebarProvider className="h-svh">
                  <AppSidebar />
                  <SidebarInset className="min-h-0 overflow-hidden">
                    {children}
                    <GlobalPlayer />
                  </SidebarInset>
                </SidebarProvider>
              </TooltipProvider>
              <AddCommand />
            </PlayerProvider>
          </CommandProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  )
}
