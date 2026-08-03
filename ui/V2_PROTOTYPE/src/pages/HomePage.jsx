import React from 'react'
import useCurrentUser from '../hooks/useCurrentUser.js'
import AiHomeWorkbench from './AiHomeWorkbench.jsx'

export default function HomePage() {
  const { user } = useCurrentUser()
  return <AiHomeWorkbench currentUser={user} />
}
