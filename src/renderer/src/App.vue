<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
// 主应用组件，使用路由来切换不同窗口的内容
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow: hidden;
}

#app {
  background: transparent !important;
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
