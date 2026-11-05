// 基础组件层统一导出。页面只从这里 import，不深入具体文件（与 ui/ 的旧约定一致）。
//
// 这些是 shadcn 风格的薄封装：样式用 Tailwind 工具类（引用 styles/token.css 的
// 语义 token），交互原语用 Base UI。代码入仓库而非依赖第三方组件库的样式包，
// 所以改样式不必等上游发版，也不会被上游的破坏性变更波及。
export { Button } from './button'
export type { ButtonProps } from './button'

export { Badge } from './badge'
export type { BadgeProps, BadgeTone } from './badge'

export { Input } from './input'
export { Textarea } from './textarea'
export { Label } from './label'

export { Switch } from './switch'
export type { SwitchProps } from './switch'

export { Checkbox } from './checkbox'
export type { CheckboxProps } from './checkbox'

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from './select'
export type { SelectProps } from './select'

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card'

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './dialog'

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetBackdrop,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './sheet'
export type { SheetContentProps, SheetSide } from './sheet'

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './alert-dialog'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from './dropdown-menu'

export { TooltipProvider, Tooltip, TooltipTrigger } from './tooltip'
export type { TooltipProps } from './tooltip'

export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
export type { TabsProps } from './tabs'

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from './table'

export { Separator } from './separator'
export type { SeparatorProps } from './separator'

export { Skeleton } from './skeleton'
export { ScrollArea } from './scroll-area'

export { Avatar, AvatarImage, AvatarFallback } from './avatar'
