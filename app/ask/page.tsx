import { AppHeader } from "@/components/app-header"
import { ChatPanel } from "@/components/chat-panel"

export default function AskPage() {
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Ask" }]} />
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ChatPanel emptyHint="Ask anything across your whole library." />
        </div>
      </div>
    </>
  )
}
