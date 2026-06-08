import { Suspense } from "react"
import { AskView } from "@/components/ask-view"

export default function AskPage() {
  return (
    <Suspense>
      <AskView />
    </Suspense>
  )
}
