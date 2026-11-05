// 组件预览页 —— Phase 1 的人工验收载体。
//
// 为什么需要它：设计系统的大部分质量是**看出来的**，不是测出来的 ——
// 玻璃有没有真模糊、暗色下对比度够不够、键盘焦点环看不看得见，jsdom 里
// 一概测不到。所以把所有代表性组件摆在一页上，人对着它逐项确认。
//
// 只在 dev 构建里可达（见 src/main.tsx 的 import.meta.env.DEV 分支），
// 生产产物不含这一页。Phase 4 全部页面迁完后删除本目录。
import { useState } from 'react'
import type { ReactNode } from 'react'
import { GlassCard, GlassFilterDefs, GlassPanel } from '../glass'
import { EmptyState, ErrorState, Skeletons, ToastProvider, useToast } from '../feedback'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../ui'
import type { BadgeTone } from '../ui'
import { ListRow, SearchField, SectionCard, Segmented, SwitchRow, TabBar, TopBar } from '../mobile'
import { applyThemeMode, resolveThemeMode, setStoredTheme } from '../../lib/theme-mode'
import type { ThemeMode } from '../../lib/theme-mode'

/** Section 是预览页的一个分节：带 heading 的标题 + 内容。 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** Swatch 是 token 色块：格子里放正文与次要文字，供人工核对对比度 ≥4.5:1。 */
function Swatch({ name, className, note }: { name: string; className: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex h-24 flex-col justify-center gap-1 rounded-lg border border-border px-3 ${className}`}
      >
        <span className="text-sm font-medium">正文 Aa 123</span>
        <span className="text-[13px] opacity-70">次要 Aa 123</span>
      </div>
      <code className="text-[11px] text-muted-foreground">{name}</code>
      {note !== undefined && <span className="text-[11px] text-muted-foreground">{note}</span>}
    </div>
  )
}

/** TokenSection 逐个展示语义 token。 */
function TokenSection() {
  return (
    <Section title="语义 token">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Swatch name="--background / --foreground" className="bg-background text-foreground" />
        <Swatch name="--card / --card-foreground" className="bg-card text-card-foreground" />
        <Swatch name="--primary" className="bg-primary text-primary-foreground" />
        <Swatch name="--destructive" className="bg-destructive text-destructive-foreground" />
        <Swatch name="--success" className="bg-success text-success-foreground" />
        <Swatch name="--warning" className="bg-warning text-warning-foreground" />
        <Swatch name="--muted / --muted-foreground" className="bg-muted text-muted-foreground" />
        <Swatch name="--popover" className="bg-popover text-popover-foreground" />
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        核对要点：每格里的「正文」与「次要」两级文字都要能看清（AA 要求 ≥4.5:1）。
      </p>
    </Section>
  )
}

/** GlassSection 展示玻璃三层。三张卡悬浮在同一块彩色画布上 —— 见下方注释。 */
function GlassSection() {
  return (
    <Section title="玻璃层">
      {/* 一块大画布，三张玻璃悬浮其上 —— 而不是「每个小格子各垫一块渐变」。
          真实界面里玻璃背后是整页内容（列表、图表、图片），不是一张贴纸；
          用小格子垫底会把玻璃效果压成「彩纸上的白卡片」，看不出悬浮感。 */}
      <div
        data-testid="preview-glass-backdrop"
        className="relative overflow-hidden rounded-2xl p-6 sm:p-10"
        style={{
          backgroundImage:
            'radial-gradient(38rem 24rem at 12% 18%, #2563eb 0%, transparent 62%),' +
            'radial-gradient(32rem 22rem at 88% 12%, #7c3aed 0%, transparent 60%),' +
            'radial-gradient(30rem 20rem at 62% 96%, #db2777 0%, transparent 62%),' +
            'linear-gradient(150deg, #1e3a8a 0%, #4c1d95 55%, #831843 100%)',
        }}
      >
        {/* 细网格：模糊后会被糊开，比纯色块更容易看出「背后确实被模糊了」 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:28px_28px]"
        />
        <div className="relative z-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <GlassCard data-testid="preview-glass-base">
            <div className="text-sm font-semibold">Layer 1 基线毛玻璃</div>
            <p className="mt-1 text-[13px] opacity-80">
              模糊 + 描边 + 内外高光。所有设备都有这一层。
            </p>
          </GlassCard>

          <GlassCard data-testid="preview-glass-refract" refract>
            <div className="text-sm font-semibold">Layer 3 边缘折射</div>
            <p className="mt-1 text-[13px] opacity-80">
              Chromium 上边缘有位移；Safari 拿不到，退回 Layer 1+2（平台限制，非缺陷）。
            </p>
          </GlassCard>

          <GlassPanel sheen data-testid="preview-glass-sheen">
            <div className="text-sm font-semibold">镜面扫光（常显）</div>
            <p className="mt-1 text-[13px] opacity-80">
              Layer 2 的另一个成分：斜向高光扫过。噪点纹理也在这一层。
            </p>
          </GlassPanel>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        核对要点：背后色块应被模糊（不是清晰透出）；边缘有 1px 描边与顶部高光；噪点让表面
        不是纯色塑料感。折射卡在 Chrome 上能看到边缘轻微位移，在 Safari 上等同于 Layer 1。
      </p>
    </Section>
  )
}

/** BasicSection 展示 shadcn 基础组件（桌面端用的那批）。 */
function BasicSection() {
  const [checked, setChecked] = useState(true)
  const [sw, setSw] = useState(false)
  const [text, setText] = useState('')
  const [tab, setTab] = useState('a')
  const tones: BadgeTone[] = ['ok', 'no', 'warn', 'neutral']

  return (
    <Section title="基础组件">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button>默认按钮</Button>
          <Button variant="outline">描边</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="destructive">危险</Button>
          <Button variant="link">链接</Button>
          <Button size="sm">小</Button>
          <Button size="lg">大</Button>
          <Button disabled>禁用</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone === 'ok' ? '正常' : tone === 'no' ? '拦截' : tone === 'warn' ? '待定' : '中性'}
            </Badge>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pv-input">输入框（正常）</Label>
            <Input
              id="pv-input"
              placeholder="输入点什么"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pv-input-err">输入框（错误态）</Label>
            <Input id="pv-input-err" aria-invalid defaultValue="不合法的值" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="pv-ta">多行输入</Label>
          <Textarea id="pv-ta" placeholder="多行文本" rows={3} />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={sw} onCheckedChange={setSw} aria-label="示例开关" />
            开关（{sw ? '开' : '关'}）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={setChecked} aria-label="示例复选框" />
            复选框（{checked ? '选中' : '未选'}）
          </label>
          <div className="w-44">
            <Select defaultValue="a" onValueChange={() => {}}>
              <SelectTrigger aria-label="示例下拉">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">选项 A</SelectItem>
                <SelectItem value="b">选项 B</SelectItem>
                <SelectItem value="c">选项 C</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>卡片标题</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              卡片是不透明容器 —— 玻璃只给「浮起」的元素（弹层、顶栏、统计卡），
              列表内部的段落卡片背后没有内容可透，做玻璃只会白耗合成开销。
            </p>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="a">标签一</TabsTrigger>
            <TabsTrigger value="b">标签二</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="pt-3 text-sm">
            第一个标签的内容。
          </TabsContent>
          <TabsContent value="b" className="pt-3 text-sm">
            第二个标签的内容。
          </TabsContent>
        </Tabs>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>结论</TableHead>
              <TableHead>耗时</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>12:00:01</TableCell>
              <TableCell>
                <Badge tone="no">拦截</Badge>
              </TableCell>
              <TableCell>0.8s</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>12:00:09</TableCell>
              <TableCell>
                <Badge tone="ok">正常</Badge>
              </TableCell>
              <TableCell>0.4s</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline">打开确认弹窗（玻璃底）</Button>} />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认执行？</AlertDialogTitle>
                <AlertDialogDescription>这是一个不可逆操作。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction>确认</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
    </Section>
  )
}

/** MobileSection 展示移动端组件层。 */
function MobileSection() {
  const [seg, setSeg] = useState('a')
  const [search, setSearch] = useState('')
  const [on, setOn] = useState(false)

  return (
    <Section title="移动端组件">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionCard title="列表行">
            <ListRow primary="列表行主文案" secondary="副行说明文字" chevron onClick={() => {}} />
            <ListRow primary="带徽标与值" badge={<Badge tone="warn">待定</Badge>} value="12" />
            <ListRow primary="等宽副行" secondary="chat_id: -1001234567890" secondaryMono />
            <ListRow primary="禁用行" disabled onClick={() => {}} />
          </SectionCard>

          <SectionCard title="开关行">
            <SwitchRow
              primary="启用判定"
              secondary="关闭后该群不判定"
              checked={on}
              onChange={setOn}
            />
            <SwitchRow primary="只读开关" checked disabled onChange={() => {}} />
          </SectionCard>
        </div>

        <div>
          <SectionCard title="分段控件">
            <div className="p-3">
              <Segmented
                value={seg}
                onChange={setSeg}
                ariaLabel="示例分段"
                options={[
                  { value: 'a', label: '判定' },
                  { value: 'b', label: '申诉' },
                  { value: 'c', label: '全部' },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard title="搜索框">
            <div className="p-3">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="搜索…"
                ariaLabel="示例搜索"
              />
            </div>
          </SectionCard>

          <SectionCard title="顶栏（玻璃）">
            <TopBar title="页面标题" subtitle="副标题" onBack={() => {}} />
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-1 text-[13px] text-muted-foreground">底栏（玻璃，固定底部）</div>
        <div className="relative h-20 overflow-hidden rounded-xl border border-border">
          <div className="absolute inset-x-0 bottom-0">
            <TabBar
              active="overview"
              onChange={() => {}}
              tabs={[
                { key: 'overview', label: '概览' },
                { key: 'bots', label: '机器人' },
                { key: 'chats', label: '群组' },
                { key: 'records', label: '记录' },
                { key: 'mine', label: '我的' },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  )
}

/** ToastProbe 是反馈层的 toast 触发按钮（要在 ToastProvider 里才能用）。 */
function ToastProbe() {
  // useToast() 直接返回 show 函数（与旧 src/ui/Toast 一致），不是 { show } 对象。
  const show = useToast()
  return <Button onClick={() => show('这是一条轻提示')}>弹出 Toast</Button>
}

/** FeedbackSection 展示反馈层组件。 */
function FeedbackSection() {
  return (
    <Section title="反馈层">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <ToastProbe />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-[13px] text-muted-foreground">空态</div>
            <EmptyState
              title="暂无数据"
              description="换个筛选条件试试，或稍后再来。"
              action={<Button size="sm">去添加</Button>}
            />
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="mb-2 text-[13px] text-muted-foreground">骨架屏</div>
            <Skeletons rows={3} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-muted-foreground">错误态（按 status 分文案）</div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <ErrorState status={0} onRetry={() => {}} />
            </div>
            <div className="rounded-lg border border-border p-4">
              <ErrorState status={403} />
            </div>
            <div className="rounded-lg border border-border p-4">
              <ErrorState status={500} onRetry={() => {}} />
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

/** ThemeToggle 是预览页顶部的亮/暗切换：调 lib/theme-mode 的持久化与 DOM 应用。 */
function ThemeToggle() {
  const [dark, setDark] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : resolveThemeMode(),
  )

  const onToggle = (next: boolean) => {
    const mode: ThemeMode = next ? 'dark' : 'light'
    setDark(mode)
    setStoredTheme(mode)
    applyThemeMode(mode)
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={dark === 'dark'} onCheckedChange={onToggle} aria-label="暗色模式" />
      暗色模式（{dark === 'dark' ? '开' : '关'}）
    </label>
  )
}

/**
 * PreviewPage 是 Phase 1 的人工验收载体：把所有代表性组件摆在一页上，
 * 人对着它逐项确认玻璃三层、暗色、对比度与键盘焦点。
 *
 * 只在 dev 构建里可达（见 src/main.tsx）；Phase 4 全部页面迁完后删除。
 */
export function PreviewPage() {
  return (
    <ToastProvider>
      {/* 折射滤镜定义：Layer 3 的 backdrop-filter 引用它，全页渲染一次即可 */}
      <GlassFilterDefs />
      {/* 不要在这里加 bg-background：那会盖住 body::before 的景深光晕，
          玻璃背后就只剩纯色、模糊效果完全看不出来。背景交给 body 的基线样式。 */}
      <div className="min-h-dvh px-4 py-6 text-foreground sm:px-6 lg:px-8">
        {/* 内容限宽居中：不限宽时在宽屏上内容全挤左侧、右侧大片空白，
            看起来像「没做完」。1360 与桌面面板的内容区一致。 */}
        <div className="mx-auto max-w-[1360px]">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold">门神 · 组件预览</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Phase 1 的人工验收载体（Phase 4 全部页面迁完后删除）。
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* 预览页是组件画廊而非长文，用比 5xl（1024）更宽的容器，
            否则三列玻璃卡在宽屏上会挤成窄条、右侧留大片空白。 */}
        <main className="mx-auto max-w-[1200px]">
          <TokenSection />
          <GlassSection />
          <BasicSection />
          <MobileSection />
          <FeedbackSection />
        </main>
        </div>
      </div>
    </ToastProvider>
  )
}
