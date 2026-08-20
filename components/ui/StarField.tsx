'use client'
 
import { useEffect } from 'react'
 
export default function StarField() {
  useEffect(() => {
    // Stars
    const starsEl = document.getElementById('login-stars')
    if (starsEl && starsEl.childElementCount === 0) {
      for (let i = 0; i < 80; i++) {
        const s = document.createElement('div')
        s.className = 'login-star'
        const size = Math.random() * 1.8 + 0.4
        s.style.cssText = `
          width: ${size}px;
          height: ${size}px;
          top: ${Math.random() * 100}%;
          left: ${Math.random() * 100}%;
          animation-duration: ${2.5 + Math.random() * 4}s;
          animation-delay: -${Math.random() * 5}s;
        `
        starsEl.appendChild(s)
      }
    }
  }, [])
 
  return null
}