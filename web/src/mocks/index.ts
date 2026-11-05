// 开发期 mock 入口：只有 import.meta.env.VITE_MOCK 为真时由 main.tsx 动态加载，
// 生产构建里这段分支是死代码，handlers/fixtures 不会进首包。
export async function startMocks(): Promise<void> {
  const [{ setupWorker }, { handlers }] = await Promise.all([
    import('msw/browser'),
    import('./handlers'),
  ])
  const worker = setupWorker(...handlers)
  await worker.start({
    // worker 文件在 public/ 下，随 rsbuild 默认的 public 复制进产物根
    // （web/public/mockServiceWorker.js，与 node_modules/msw/lib/ 下的原件逐字节相同）。
    // 不读 import.meta.env.BASE_URL：rsbuild 不提供它，而 Mini App 的 assetPrefix
    // 固定是 /miniapp/（见 rsbuild.config.ts），写常量即可。
    serviceWorker: { url: '/miniapp/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
  console.info('[mocks] MSW 已启动，数据来自 web/src/mocks/fixtures.ts')
}
