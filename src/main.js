import { createApp } from 'vue'
import App from './App.vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import 'vuetify/styles'

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
    VMenu: { rounded: 0 },
    VList: { rounded: 0 },
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
