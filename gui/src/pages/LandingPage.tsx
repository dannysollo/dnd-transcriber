export default function LandingPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0f1117',
      color: '#e2e8f0',
      fontFamily: 'inherit',
      padding: '24px',
      boxSizing: 'border-box',
    }}>
      {/* Icon */}
      <div style={{ fontSize: '72px', lineHeight: 1, marginBottom: '24px' }}>🎲</div>

      {/* Title */}
      <h1 style={{
        margin: '0 0 12px',
        fontSize: '36px',
        fontWeight: 800,
        color: '#7c6cfc',
        letterSpacing: '-0.5px',
      }}>
        DnD Transcriber
      </h1>

      {/* Subtitle */}
      <p style={{
        margin: '0 0 40px',
        fontSize: '15px',
        color: '#64748b',
        textAlign: 'center',
        maxWidth: '460px',
        lineHeight: 1.6,
      }}>
        Automatic session transcription for your campaign. Record with Craig, transcribe with Whisper, review with your party.
      </p>

      {/* Feature row */}
      <div style={{
        display: 'flex',
        gap: '32px',
        marginBottom: '48px',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {[
          { icon: '🎙️', text: 'Per-speaker transcription powered by Whisper' },
          { icon: '📜', text: 'Edit, review, and approve transcript changes' },
          { icon: '⚔️', text: 'Campaign management for your whole party' },
        ].map(({ icon, text }) => (
          <div key={text} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            maxWidth: '160px',
            textAlign: 'center',
          }}>
            <span style={{ fontSize: '28px' }}>{icon}</span>
            <span style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>

      {/* Login button */}
      <a
        href="/auth/discord"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: '#5865f2',
          color: '#fff',
          textDecoration: 'none',
          borderRadius: '999px',
          padding: '12px 28px',
          fontSize: '15px',
          fontWeight: 700,
          letterSpacing: '0.01em',
          boxShadow: '0 4px 20px rgba(88,101,242,0.4)',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        {/* Discord logo SVG */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
        Login with Discord
      </a>

      {/* Footer */}
      <p style={{
        marginTop: '48px',
        fontSize: '12px',
        color: '#334155',
      }}>
        Built for tabletop sessions
      </p>
    </div>
  )
}
