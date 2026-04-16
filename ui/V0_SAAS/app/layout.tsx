import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { AppProviders } from './providers'

export const metadata: Metadata = {
  title: 'WorkEvolutionSys',
  description: '全新一代智能工作流平台，让团队协作更高效、更智能',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-svh bg-background text-foreground">
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  )
}
