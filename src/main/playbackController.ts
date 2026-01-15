import { videoPlayerApp } from './videoPlayerApp'

interface MediaTarget {
  path: string
  name?: string
}

const createTimestamp = () => `[${new Date().toISOString()}]`

export async function handlePlayMedia(target: MediaTarget): Promise<void> {
  const name = target.name || target.path
  await videoPlayerApp.play({ path: target.path, name })
}
