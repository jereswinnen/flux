import { AppHeader } from "@/components/app-header"
import { ChatPanel } from "@/components/chat-panel"

export default function AskPage() {
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Ask" }]} />
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        <div>
          <h1 className="text-lg font-semibold">Ask your library</h1>
          <p className="text-sm text-muted-foreground">
            Question everything you&apos;ve transcribed. Answers cite the episodes and moments they came from.
          </p>
        </div>
        <div className="flex h-[calc(100vh-12rem)] flex-col overflow-hidden rounded-xl border bg-card">
          <ChatPanel emptyHint="Ask anything across your whole library." />
        </div>
      </div>
    </>
  )
}
