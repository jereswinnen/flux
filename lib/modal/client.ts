export async function triggerTranscription(itemId: string, audioUrl: string) {
  const endpoint = process.env.MODAL_TRANSCRIBE_URL
  const secret = process.env.MODAL_WEBHOOK_SECRET
  const appUrl = process.env.APP_URL
  if (!endpoint || !secret || !appUrl) {
    throw new Error("Modal env not configured (MODAL_TRANSCRIBE_URL/SECRET/APP_URL)")
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      episode_id: itemId, // wire key unchanged; deployed Modal fn echoes it back
      audio_url: audioUrl,
      callback_url: `${appUrl}/api/modal/callback`,
      secret,
    }),
  })
  if (!res.ok) throw new Error(`Modal trigger failed: ${res.status}`)
}
