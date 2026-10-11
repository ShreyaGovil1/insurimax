import { useMemo } from "react"
import { cn } from "../../lib/utils"

/**
 * Security-print linework, as on policy certificates and stamp paper:
 * interfering sine waves drawn as crisp vectors.
 */
export function Guilloche({ className, lines = 18, width = 1200, height = 220, strokeClassName = "stroke-white/10" }) {
  const paths = useMemo(() => {
    const mid = height / 2
    const a1 = height * 0.3
    const a2 = height * 0.11
    const k1 = (2 * Math.PI) / (width / 3.3)
    const k2 = (2 * Math.PI) / (width / 10.5)
    return Array.from({ length: lines }, (_, i) => {
      const phase = (i / lines) * Math.PI * 2
      let d = ""
      for (let x = 0; x <= width; x += 6) {
        const y = mid + a1 * Math.sin(k1 * x + phase) + a2 * Math.sin(k2 * x - phase * 2)
        d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`
      }
      return d
    })
  }, [lines, width, height])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("pointer-events-none", className)}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" className={strokeClassName} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
