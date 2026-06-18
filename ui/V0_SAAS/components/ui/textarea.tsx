import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'placeholder:text-muted-foreground selection:bg-accent/15 selection:text-foreground dark:selection:bg-accent/25 dark:selection:text-accent-foreground flex field-sizing-content min-h-16 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-base shadow-none transition-[color,border-color] outline-none focus-visible:border-ring/60 focus-visible:ring-0 dark:focus-visible:border-ring/55 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-card/50 aria-invalid:border-destructive aria-invalid:ring-0 dark:aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
