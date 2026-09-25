import { createApp } from 'vue'
import App from './App.vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import 'vuetify/styles'
import './styles/menu.css'
import './styles/dialog.css'
import './styles/progress.css'

/* 不支持注册自定义属性（@property）的浏览器，进度条文字没法跟填充的 width 过渡逐帧同步，
   progress.css 里准备了按 50% 整段换色的兜底分支，用这个类打开 */
if (!('registerProperty' in (window.CSS ?? {}))) {
  document.documentElement.classList.add('no-registered-props')
}

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#18181b',
          secondary: '#71717a',
          surface: '#ffffff',
          background: '#fafafa',
          error: '#ef4444',
          success: '#22c55e',
          info: '#3b82f6',
          warning: '#f59e0b',
          accent: '#6366f1',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 0 },
    VCard: { flat: true, rounded: 0 },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 0 },
    VChip: { rounded: 0 },
    VDialog: { rounded: 0 },
    VSheet: { rounded: 0 },
    // 浮层菜单（VMenu / VList）的外观统一在 src/styles/menu.css 里定义，这里不设 rounded
    VAlert: { rounded: 0 },
    VSnackbar: { rounded: 0 },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
      svg: mdi,
    },
  },
})

const app = createApp(App)
app.use(vuetify)
app.mount('#app')
