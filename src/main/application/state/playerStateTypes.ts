export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

export interface PlayerState {
  phase: PlayerPhase
  currentTime: number
  duration: number
  volume: number
  path: string | null
  error: string | null
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
}
