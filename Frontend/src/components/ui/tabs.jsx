import * as React from "react"
import { cn } from "../../lib/utils"

const TabsContext = React.createContext({
  value: "",
  onValueChange: () => {},
})

export function Tabs({ value, defaultValue, onValueChange, className, children }) {
  const [activeTab, setActiveTab] = React.useState(defaultValue || "")
  const currentTab = value !== undefined ? value : activeTab

  const handleTabChange = (val) => {
    if (value === undefined) {
      setActiveTab(val)
    }
    onValueChange?.(val)
  }

  return (
    <TabsContext.Provider value={{ value: currentTab, onValueChange: handleTabChange }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, children }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-xl bg-sunken p-1", className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({ value, className, children }) {
  const { value: selectedValue, onValueChange } = React.useContext(TabsContext)
  const isSelected = selectedValue === value

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      onClick={() => onValueChange(value)}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg px-3 text-small font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peacock-500",
        isSelected ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink-2",
        className
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, className, children }) {
  const { value: selectedValue } = React.useContext(TabsContext)
  if (selectedValue !== value) return null

  return <div className={cn("mt-4 animate-rise focus-visible:outline-none", className)}>{children}</div>
}
