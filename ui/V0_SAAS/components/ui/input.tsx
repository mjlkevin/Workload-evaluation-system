import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-accent/15 selection:text-foreground dark:selection:bg-accent/25 dark:selection:text-accent-foreground h-9 w-full min-w-0 rounded-md border border-border/70 bg-background px-3 py-1 text-base shadow-none transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-card/50',
        'focus-visible:border-ring/60 focus-visible:ring-0 dark:focus-visible:border-ring/55',
        'aria-invalid:border-destructive aria-invalid:ring-0 dark:aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
