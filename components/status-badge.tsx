import { Badge } from "@/components/ui/badge"
import { statusVariant } from "@/lib/item-status"

export function StatusBadge({ status, inFlight }: { status: string; inFlight: boolean }) {
  return (
    <Badge variant={statusVariant(status)} className={inFlight ? "animate-pulse" : ""}>
      {status}
    </Badge>
  )
}
