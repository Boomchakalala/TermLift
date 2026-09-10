'use client'

import { useEffect } from 'react'

/**
 * Freeze the page behind an overlay while it is open. `overflow: hidden` on
 * the body is not enough on iOS Safari: touch scrolling still moves the
 * page, so the panel under the finger stays put and the page behind it
 * scrolls instead. Pinning the body with `position: fixed` at its current
 * scroll offset stops that; the offset is restored on unmount.
 */
export function useLockBodyScroll(locked = true) {
  useEffect(() => {
    if (!locked) return
    const body = document.body
    const scrollY = window.scrollY
    const prev = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, overflow: body.style.overflow, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.left = prev.left
      body.style.right = prev.right
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, scrollY)
    }
  }, [locked])
}
