import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './AuthContext.tsx'
import { CampaignProvider } from './CampaignContext.tsx'
import { ToastProvider } from './Toast.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import UpdateNotice from './UpdateNotice.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CampaignProvider>
            <ToastProvider>
              <App />
              <UpdateNotice />
            </ToastProvider>
          </CampaignProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
