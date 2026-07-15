<template>
  <v-app class="app-root">
    <v-app-bar
      v-if="!isDeviceMode"
      flat
      height="48"
      color="surface"
      class="app-toolbar"
    >
      <v-btn icon variant="text" size="small" @click="goBackToDevice">
        <v-icon size="20" :icon="mdiArrowLeft" />
      </v-btn>
      <v-app-bar-title class="text-body-2 font-weight-medium text-secondary">
        远程观看
      </v-app-bar-title>
    </v-app-bar>

    <DeviceView v-if="isDeviceMode" :room-name="roomName" :current-user="currentUser">
      <template #remote-button>
        <v-btn
          variant="text"
          size="small"
          class="ml-1 text-none text-secondary"
          @click="isDeviceMode = false"
        >
          <v-icon start size="16" :icon="mdiCastConnected" />
          远程观看
        </v-btn>
      </template>
    </DeviceView>

    <RemoteView v-else :initial-peer-id="initialPeerId" />
  </v-app>
</template>

<script setup>
import { mdiArrowLeft, mdiCastConnected } from '@mdi/js'

import { ref, onMounted, defineAsyncComponent } from 'vue';
import { VApp, VIcon, VBtn, VAppBar, VAppBarTitle } from 'vuetify/components';
const DeviceView = defineAsyncComponent(() => import('./views/DeviceView.vue'));
const RemoteView = defineAsyncComponent(() => import('./views/RemoteView.vue'));

const roomName = ref('default-room');
const currentUser = ref({
  id: 'default-user',
  name: 'Default User',
});

const isDeviceMode = ref(true);
const initialPeerId = ref('');

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const remotePeerId = urlParams.get('remote');
  if (remotePeerId) {
    initialPeerId.value = remotePeerId;
    isDeviceMode.value = false;
  }
});

function goBackToDevice() {
  isDeviceMode.value = true;
  initialPeerId.value = '';
  const url = new URL(window.location.href);
  url.searchParams.delete('remote');
  window.history.replaceState({}, '', url.toString());
}
</script>

<style>
:root {
  --border: rgba(24, 24, 27, 0.08);
  --border-hover: rgba(24, 24, 27, 0.16);
  --muted: rgba(24, 24, 27, 0.5);
  --cta-bg: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  --cta-hover: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
}

html,
body,
#app {
  height: 100%;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app-toolbar {
  border-bottom: 1px solid var(--border) !important;
}

*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: rgba(24, 24, 27, 0.12);
  border-radius: 3px;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(24, 24, 27, 0.2);
}
</style>
