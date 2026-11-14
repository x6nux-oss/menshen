import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import {
  Glass,
  animateGlassValue,
  deriveGlass,
  glassValue,
  rubberBand,
  useLensWobble,
} from '@samasante/liquid-glass'
import { cn } from '../../lib/utils'

export interface TabBarItem {
  key: string
  label: ReactNode
  icon?: ReactNode
}

export interface TabBarProps {
  tabs: TabBarItem[]
  active: string
  onChange: (key: string) => void
  ariaLabel?: string
  className?: string
}

const LENS_OPTICS = {
  mapSize: 256,
  strength: 0.16,
  depth: 0.24,
  curvature: 0.32,
  dispersion: 0.45,
  bend: 0.18,
  bendWidth: 0.12,
  frost: 0,
  brightness: 0.025,
  sheen: 0.5,
  sheenWidth: 1.2,
  glow: 0.025,
  edgeShadow: '0 3px 12px rgb(0 0 0 / 12%)',
}

export function TabBar({ tabs, active, onChange, ariaLabel, className }: TabBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === active))
  const activeRef = useRef(activeIndex)
  const gesture = useRef<{ id: number; startX: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const hold = useRef(0)
  const kick = useRef(() => {})
  const motion = useMemo(() => {
    const count = Math.max(1, tabs.length)
    const trackWidth = glassValue(0)
    const position = glassValue(0)
    const press = glassValue(0)
    const stretch = glassValue(0)
    const reduced = glassValue(0)
    const width = deriveGlass([trackWidth, press, stretch, reduced], () =>
      Math.max(0, trackWidth.get() / count - 4) *
      (1 + (reduced.get() ? 0 : press.get() * 0.1 + stretch.get() * 0.2)),
    )
    const height = deriveGlass([press, stretch, reduced], () =>
      50 * (1 + (reduced.get() ? 0 : press.get() * 0.1 - stretch.get() * 0.18)),
    )
    const center = deriveGlass([position, trackWidth], () => position.get() / Math.max(1, trackWidth.get()))
    return { count, trackWidth, position, press, stretch, reduced, width, height, center }
  }, [tabs.length])

  useLensWobble(motion.position, motion.stretch, hold, kick)

  useLayoutEffect(() => {
    activeRef.current = activeIndex
  }, [activeIndex])

  useLayoutEffect(() => {
    const measure = () => {
      const width = trackRef.current?.getBoundingClientRect().width ?? 0
      motion.trackWidth.set(width)
      animateGlassValue(motion.position, (activeRef.current + 0.5) * width / motion.count, { duration: 0 })
      animateGlassValue(motion.press, 0, { duration: 0 })
      hold.current = 0
      if (gesture.current) suppressClick.current = true
      gesture.current = null
    }
    measure()
    window.addEventListener('resize', measure)
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const updatePreference = () => {
      motion.reduced.set(preference?.matches ? 1 : 0)
      if (preference?.matches) measure()
    }
    updatePreference()
    preference?.addEventListener('change', updatePreference)
    return () => {
      window.removeEventListener('resize', measure)
      preference?.removeEventListener('change', updatePreference)
      animateGlassValue(motion.position, motion.position.get(), { duration: 0 })
      animateGlassValue(motion.press, 0, { duration: 0 })
    }
  }, [motion])

  useEffect(() => {
    if (gesture.current) return
    animateGlassValue(motion.position, (activeIndex + 0.5) * motion.trackWidth.get() / motion.count, {
      duration: motion.reduced.get() ? 0 : 0.46,
    })
  }, [activeIndex, motion])

  function settle(index: number) {
    hold.current = 0
    const duration = motion.reduced.get() ? 0 : 0.46
    animateGlassValue(motion.press, 0, { duration })
    animateGlassValue(motion.position, (index + 0.5) * motion.trackWidth.get() / motion.count, { duration })
  }

  function pulse() {
    if (motion.reduced.get()) return
    hold.current = 0.12
    kick.current()
    animateGlassValue(motion.press, 1, {
      duration: 0.12,
      onComplete: () => {
        hold.current = 0
        animateGlassValue(motion.press, 0, { duration: 0.46 })
      },
    })
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || gesture.current) return
    const button = (event.target as HTMLElement).closest('button')
    if (!button) return
    const bounds = event.currentTarget.getBoundingClientRect()
    motion.trackWidth.set(bounds.width)
    gesture.current = { id: event.pointerId, startX: event.clientX, moved: false }
    suppressClick.current = false
    button.setPointerCapture?.(event.pointerId)
    hold.current = motion.reduced.get() ? 0 : 0.12
    kick.current()
    animateGlassValue(motion.press, 1, { duration: motion.reduced.get() ? 0 : 0.18 })
    const index = Number(button.dataset.index)
    animateGlassValue(motion.position, (index + 0.5) * bounds.width / motion.count, {
      duration: motion.reduced.get() ? 0 : 0.26,
    })
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    if (Math.abs(event.clientX - current.startX) > 4) current.moved = true
    if (!current.moved) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const half = bounds.width / motion.count / 2
    const position = event.clientX - bounds.left
    const minimum = half
    const maximum = bounds.width - half
    const next = position < minimum
      ? minimum - rubberBand(minimum - position, 12, 120)
      : position > maximum
        ? maximum + rubberBand(position - maximum, 12, 120)
        : position
    animateGlassValue(motion.position, next, { duration: 0 })
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    gesture.current = null
    if (current.moved) {
      const bounds = event.currentTarget.getBoundingClientRect()
      const index = Math.max(0, Math.min(tabs.length - 1,
        Math.floor((event.clientX - bounds.left) / Math.max(1, bounds.width) * motion.count),
      ))
      suppressClick.current = true
      settle(activeIndex)
      if (tabs[index] && tabs[index].key !== active) onChange(tabs[index].key)
    } else {
      settle(activeIndex)
    }
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return
    gesture.current = null
    suppressClick.current = true
    settle(activeIndex)
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = Number((event.target as HTMLElement).closest('button')?.dataset.index)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (!tabs[next]) return
    event.preventDefault()
    trackRef.current?.querySelectorAll('button')[next]?.focus()
    pulse()
    onChange(tabs[next].key)
  }

  const face = (tab: TabBarItem) => (
    <>
      {tab.icon !== undefined && <span className="liquid-dock-icon" aria-hidden>{tab.icon}</span>}
      <span className="liquid-dock-label">{tab.label}</span>
    </>
  )

  return (
    <nav aria-label={ariaLabel ?? '主导航'} className={cn('liquid-dock', className)}>
      <Glass className="liquid-dock-surface" radius={34} optics={{ frost: 16, strength: 0.08, dispersion: 0.15, specular: 0.45, brightness: 0.015 }}>
        <div
          ref={trackRef}
          className="liquid-dock-track"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancelPointer}
          onLostPointerCapture={cancelPointer}
          onKeyDown={keyDown}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              data-index={index}
              aria-current={tab.key === active ? 'page' : undefined}
              className="liquid-dock-item"
              onClick={(event) => {
                if (event.detail !== 0 && suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                pulse()
                onChange(tab.key)
              }}
            >
              {face(tab)}
            </button>
          ))}
          <Glass
            className="liquid-dock-lens"
            aria-hidden="true"
            inert
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            center={{ x: motion.center, y: 0.5 }}
            width={motion.width}
            height={motion.height}
            radius={26}
            optics={LENS_OPTICS}
            behind="var(--dock-lens-fill)"
            refract={<div className="liquid-dock-copy" />}
          />
        </div>
      </Glass>
    </nav>
  )
}
