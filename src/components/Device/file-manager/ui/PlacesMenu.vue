<script setup lang="ts">
import { mdiCheck, mdiFolderStarOutline, mdiStarOutline } from '@mdi/js';
import { computed } from 'vue';

import { useSettings } from '../shared/settings';

const props = defineProps<{ currentPath: string }>();
const emit = defineEmits<{ (e: 'navigate', path: string): void }>();

const prefs = useSettings();

/** 各个 Android 版本都有的入口 */
const PLACES: { title: string; path: string }[] = [
  { title: '下载', path: '/sdcard/Download' },
  { title: '相机', path: '/sdcard/DCIM' },
  { title: '图片', path: '/sdcard/Pictures' },
  { title: '视频', path: '/sdcard/Movies' },
  { title: '文档', path: '/sdcard/Documents' },
  { title: '应用数据', path: '/sdcard/Android/data' },
  { title: '临时目录', path: '/data/local/tmp' },
];

const bookmarked = computed(() => prefs.bookmarks.includes(props.currentPath));

const toggleBookmark = () => {
  const path = props.currentPath;
  prefs.bookmarks = bookmarked.value
    ? prefs.bookmarks.filter((item) => item !== path)
    : [...prefs.bookmarks, path];
};

const removeBookmark = (path: string) => {
  prefs.bookmarks = prefs.bookmarks.filter((item) => item !== path);
};
</script>

<template>
  <v-menu location="bottom start">
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        icon
        variant="text"
        size="x-small"
        title="常用路径与收藏"
      >
        <v-icon size="16" :icon="prefs.bookmarks.length ? mdiFolderStarOutline : mdiStarOutline" />
      </v-btn>
    </template>
    <v-list density="compact" class="places-list">
      <v-list-item :title="bookmarked ? '取消收藏当前目录' : '收藏当前目录'" @click="toggleBookmark">
        <template #append>
          <v-icon v-if="bookmarked" size="16" :icon="mdiCheck" />
        </template>
      </v-list-item>
      <v-divider />
      <v-list-item
        v-for="place in PLACES"
        :key="place.path"
        class="places-item"
        :title="place.title"
        :subtitle="place.path"
        @click="emit('navigate', place.path)"
      />
      <template v-if="prefs.bookmarks.length">
        <v-divider class="places-divider" />
        <v-list-item
          v-for="path in prefs.bookmarks"
          :key="path"
          class="places-item"
          :title="path"
          @click="emit('navigate', path)"
        >
          <template #append>
            <v-btn
              icon
              variant="text"
              size="x-small"
              title="取消收藏"
              @click.stop="removeBookmark(path)"
            >
              <v-icon size="14" :icon="mdiStarOutline" />
            </v-btn>
          </template>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>
</template>

<style scoped>
.places-list :deep(.places-item + .places-item) {
  margin-top: 6px;
}

.places-list :deep(.places-divider) {
  margin: 6px 0;
}
</style>
