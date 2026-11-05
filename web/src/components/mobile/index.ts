// 移动端组件层统一导出。Mini App 的页面与外壳从这里 import。
//
// 这些组件与旧 src/ui/ 的同名组件**语义与 props 对齐**，但底层从 MUI 换成
// Tailwind + Base UI。Phase 2/3 逐页迁移时，调用点只需改 import 路径。
export { ActionSheetProvider, useConfirm } from './ActionSheet'
export type { ActionSheetProviderProps, ConfirmFn, ConfirmOptions } from './ActionSheet'
export { ListRow } from './ListRow'
export type { ListRowProps } from './ListRow'
export { SearchField } from './SearchField'
export type { SearchFieldProps } from './SearchField'
export { SectionCard } from './SectionCard'
export type { SectionCardProps } from './SectionCard'
export { Segmented } from './Segmented'
export type { SegmentedOption, SegmentedProps } from './Segmented'
export { SwitchRow } from './SwitchRow'
export type { SwitchRowProps } from './SwitchRow'
export { TabBar } from './TabBar'
export type { TabBarItem, TabBarProps } from './TabBar'
export { TopBar } from './TopBar'
export type { TopBarProps } from './TopBar'

export { ChatRef } from './ChatRef'
export type { ChatRefProps } from './ChatRef'
export { FormDrawer } from './FormDrawer'
export type { FormDrawerProps } from './FormDrawer'
export { SettingRow } from './SettingRow'
export type { SettingRowProps } from './SettingRow'
