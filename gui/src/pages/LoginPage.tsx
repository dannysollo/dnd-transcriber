import { useAuth } from '../AuthContext'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { DiscordButton, FrontCover } from '../Brand'

export default function LoginPage() {
  const { isLoggedIn, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && isLoggedIn) navigate('/', { replace: true })
  }, [isLoggedIn, loading, navigate])

  return (
    <FrontCover tagline="Log in to open your campaigns.">
      <DiscordButton />
    </FrontCover>
  )
}
