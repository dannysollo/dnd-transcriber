import { DiscordButton, FrontCover } from '../Brand'

/** Logged-out front page: the journal's front cover, with the way in. */
export default function LandingPage() {
  return (
    <FrontCover tagline="Record your sessions with Craig, get a transcript of who said what, and keep the campaign's story together with your party.">
      <DiscordButton />
      <p className="cover-note">Built for tabletop groups on Discord.</p>
    </FrontCover>
  )
}
