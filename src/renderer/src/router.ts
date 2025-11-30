import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'Main',
      component: () => import('./views/MainView.vue')
    },
    {
      path: '/video',
      name: 'Video',
      component: () => import('./views/VideoView.vue')
    },
    {
      path: '/control',
      name: 'Control',
      component: () => import('./views/ControlView.vue')
    }
  ]
})

export default router

