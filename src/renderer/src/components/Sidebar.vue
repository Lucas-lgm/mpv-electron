<template>
  <div class="sidebar">
    <SidebarSection
      title="资源"
      :show-add-button="false"
    >
      <SidebarItem
        :active="props.activeFilter === 'all'"
        icon="📁"
        label="全部资源"
        @click="$emit('filter-change', 'all')"
      />
      <SidebarItem
        :active="props.activeFilter === 'local'"
        icon="💾"
        label="本地文件"
        @click="$emit('filter-change', 'local')"
      />
      <SidebarItem
        :active="props.activeFilter === 'network'"
        icon="🌐"
        label="网络资源"
        @click="$emit('filter-change', 'network')"
      />
    </SidebarSection>

    <SidebarSection
      title="挂载路径"
      :show-add-button="true"
      add-button-title="添加挂载路径"
      @add="$emit('mount-path-add')"
    >
      <MountPathItem
        v-for="mountPath in props.mountPaths"
        :key="mountPath.id"
        :mount-path="mountPath"
        :active="props.selectedMountPath === mountPath.id"
        @select="$emit('mount-path-select', mountPath.id)"
        @refresh="$emit('mount-path-refresh', mountPath.id)"
        @remove="$emit('mount-path-remove', mountPath.id)"
      />
    </SidebarSection>

    <SidebarSection
      title="NAS 连接"
      :show-add-button="true"
      add-button-title="添加 NAS"
      @add="$emit('nas-add')"
    >
      <NasConnectionItem
        v-for="nasConnection in props.nasConnections"
        :key="nasConnection.id"
        :nas-connection="nasConnection"
        :active="props.selectedNasConnection === nasConnection.id"
        @select="$emit('nas-select', nasConnection.id)"
        @open="$emit('nas-open', nasConnection.id)"
        @refresh="$emit('nas-refresh', nasConnection.id)"
        @remove="$emit('nas-remove', nasConnection.id)"
      />
    </SidebarSection>

    <SidebarSection title="最近">
      <SidebarItem
        icon="🕒"
        label="最近播放"
        @click="$emit('filter-change', 'recent')"
      />
      <SidebarItem
        icon="⭐"
        label="收藏"
        @click="$emit('filter-change', 'favorite')"
      />
      <SidebarItem
        icon="📋"
        label="播放列表"
        @click="$emit('filter-change', 'playlist')"
      />
    </SidebarSection>
  </div>
</template>

<script setup lang="ts">
import SidebarSection from './SidebarSection.vue'
import SidebarItem from './SidebarItem.vue'
import MountPathItem from './MountPathItem.vue'
import NasConnectionItem from './NasConnectionItem.vue'
import type { MountPath, NasConnection } from '../types/mount'
import type { ResourceFilter } from '../types/media'

interface Props {
  activeFilter: ResourceFilter
  mountPaths: MountPath[]
  selectedMountPath: string | null
  nasConnections: NasConnection[]
  selectedNasConnection: string | null
}

const props = defineProps<Props>()

defineEmits<{
  'filter-change': [filter: ResourceFilter]
  'mount-path-select': [id: string]
  'mount-path-add': []
  'mount-path-remove': [id: string]
  'mount-path-refresh': [id: string]
  'nas-add': []
  'nas-select': [id: string]
  'nas-open': [id: string]
  'nas-remove': [id: string]
  'nas-refresh': [id: string]
}>()
</script>

<style scoped>
.sidebar {
  width: 240px;
  background: #1f1f26;
  border-right: 1px solid #2d2d35;
  padding: 20px 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
</style>
