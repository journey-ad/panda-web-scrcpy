import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import {
    configureVueProject,
    defineConfigWithVueTs,
    vueTsConfigs,
} from '@vue/eslint-config-typescript';

// 项目内 .vue 的 script 有 ts 与 js 两种写法
configureVueProject({ scriptLangs: ['ts', 'js'] });

export default defineConfigWithVueTs(
    {
        name: 'app/files-to-lint',
        files: ['**/*.{js,mjs,cjs,ts,mts,tsx,jsx,vue}'],
        languageOptions: {
            globals: { ...globals.browser, ...globals.es2022 },
        },
    },
    {
        name: 'app/files-to-ignore',
        ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'public/scrcpy-server*'],
    },
    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommended,
    {
        name: 'app/node-files',
        files: ['plugins/**/*.{js,cjs,mjs}', 'vite.config.ts'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    {
        name: 'app/public-scripts',
        files: ['public/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        name: 'app/rules',
        rules: {
            'vue/multi-word-component-names': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
