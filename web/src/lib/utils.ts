import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * cn 合并 className：clsx 处理条件类，tailwind-merge 消解冲突
 * （后面的同类工具类赢，如 cn('p-2', 'p-4') → 'p-4'）。
 * shadcn 组件的标准写法，不要用字符串拼接替代。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
