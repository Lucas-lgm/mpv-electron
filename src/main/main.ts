import { videoPlayerApp } from './videoPlayerApp'

videoPlayerApp.init()

export const windowManager = videoPlayerApp.windowManager
export const createVideoWindow = () => videoPlayerApp.createVideoWindow()
