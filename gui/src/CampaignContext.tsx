import React, { createContext, useContext, useEffect, useState } from 'react'

export interface Campaign {
  id: number
  slug: string
  name: string
  role: string
}

interface CampaignContextType {
  campaigns: Campaign[]
  activeCampaign: Campaign | null
  setActiveCampaign: (c: Campaign | null) => void
  loading: boolean
}

const CampaignContext = createContext<CampaignContextType>({
  campaigns: [],
  activeCampaign: null,
  setActiveCampaign: () => {},
  loading: true,
})

const STORAGE_KEY = 'dnd_active_campaign_slug'

export function CampaignProvider({ children }: { children: React.ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activeCampaign, setActiveCampaignState] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/campaigns')
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        const campaignList: Campaign[] = data.map(c => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          role: c.role ?? 'member',
        }))
        setCampaigns(campaignList)

        // Restore from localStorage
        const savedSlug = localStorage.getItem(STORAGE_KEY)
        if (savedSlug) {
          const found = campaignList.find(c => c.slug === savedSlug)
          if (found) {
            setActiveCampaignState(found)
          } else if (campaignList.length > 0) {
            setActiveCampaignState(campaignList[0])
          }
        } else if (campaignList.length > 0) {
          setActiveCampaignState(campaignList[0])
        }
      })
      .catch(() => {
        setCampaigns([])
      })
      .finally(() => setLoading(false))
  }, [])

  const setActiveCampaign = (c: Campaign | null) => {
    setActiveCampaignState(c)
    if (c) {
      localStorage.setItem(STORAGE_KEY, c.slug)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  return (
    <CampaignContext.Provider value={{ campaigns, activeCampaign, setActiveCampaign, loading }}>
      {children}
    </CampaignContext.Provider>
  )
}

export function useCampaign() {
  return useContext(CampaignContext)
}

/**
 * Returns a URL builder that prepends /campaigns/{slug} when an active campaign
 * is set, falling back to the bare path for legacy / no-auth mode.
 *
 * Usage:
 *   const apiUrl = useApiUrl()
 *   fetch(apiUrl('/sessions'))          // → /campaigns/my-slug/sessions
 *   fetch(apiUrl('/config/corrections')) // → /campaigns/my-slug/config/corrections
 */
export function useApiUrl() {
  const { activeCampaign } = useCampaign()
  return (path: string) => {
    if (activeCampaign) {
      return `/campaigns/${activeCampaign.slug}${path}`
    }
    return path
  }
}
