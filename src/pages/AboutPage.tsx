import { useNavigate } from 'react-router-dom';
import { Icon } from '../assets/icons';
import { IconButton } from '../components/ui/IconButton';
import { ScreenShell } from '../components/ui/ScreenShell';
import packageJson from '../../package.json';
import './AboutPage.css';

const features = [
  {
    icon: 'shield',
    title: 'Protect and Present Your Artwork',
    description: 'Keep original uploads private and choose whether processed previews appear in your portfolio or discovery. Preview options can add visible ownership marks or visual effects and suppress right-click or drag actions; they cannot prevent every copy, screenshot, or scrape.',
  },
  {
    icon: 'compass',
    title: 'Find Artists and Request Commissions',
    description: 'Explore artist profiles and portfolios, then use available commission request flows to connect around a project. Artist verification is an application review, not a guarantee of identity or transaction safety.',
  },
  {
    icon: 'chat',
    title: 'Keep Commission Conversations Organized',
    description: 'Message directly, share artwork and attachments, and keep project conversations together. Chat blocking is available, but messages are not a scam-detection service.',
  },
  {
    icon: 'check-circle',
    title: 'Manage Commission Progress',
    description: 'Use the commission workspace to follow progress, submit and review milestones, share deliverables, and record approvals as the project moves forward.',
  },
] as const;

const principles = [
  {
    title: 'Respect for Creative Ownership',
    description: "Encourage permission, appropriate attribution, and respect for artists' work.",
  },
  {
    title: 'Safer Commission Experiences',
    description: 'Encourage clear communication, transparent project expectations, and responsible interactions.',
  },
  {
    title: 'Artist-Centered Design',
    description: 'Prioritize tools and workflows that support artists while enabling clients to work with creators effectively.',
  },
] as const;

export function AboutPage() {
  const navigate = useNavigate();

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between about-header">
          <div className="row gap-10">
            <IconButton
              icon="chevron-l"
              onClick={() => navigate('/profile/settings')}
              ariaLabel="Back to Settings"
            />
            <span className="h-title about-header-title">About ArtGuard Hub</span>
          </div>
        </div>
      }
      contentClassName="about-content"
    >
      <div className="about-page">
        <section className="about-hero card ag-liquid-glass-strong" aria-labelledby="about-title">
          <div className="about-hero-mark" aria-hidden="true">
            <Icon name="shield" />
          </div>
          <div className="about-hero-copy">
            <p className="about-eyebrow">Built around artist protection</p>
            <h1 id="about-title">Your Art Deserves Protection.</h1>
            <p className="about-tagline">Protecting creativity. Supporting safer commissions.</p>
            <p className="about-introduction">
              ArtGuard Hub is a digital art platform built around helping artists present their creative work and
              navigate commissions with greater confidence. In a digital world where artwork can be reused without
              permission and commission scams are a concern, ArtGuard Hub brings artist profiles, artwork sharing,
              direct communication, and commission management together in one place. Its available preview safeguards
              can add deterrents, but cannot guarantee that artwork will not be copied or scraped.
            </p>
          </div>
        </section>

        <section className="about-section about-why" aria-labelledby="about-why-title">
          <div className="about-section-heading">
            <span className="about-kicker">The challenges artists face</span>
            <h2 id="about-why-title">Why ArtGuard Hub Exists</h2>
          </div>
          <p>
            Digital artists face concerns including AI scraping and artwork copied, redistributed, or used without
            permission. Online commission requests can also involve impersonation or dishonest interactions, while
            unclear requirements, communication, and progress can make projects harder to navigate. These are challenges
            ArtGuard Hub aims to help artists manage—not risks the app can eliminate.
          </p>
        </section>

        <section className="about-section" aria-labelledby="about-features-title">
          <div className="about-section-heading">
            <span className="about-kicker">Tools for presenting work and navigating commissions</span>
            <h2 id="about-features-title">How ArtGuard Hub Supports Artists</h2>
          </div>
          <div className="about-feature-grid">
            {features.map((feature) => (
              <article className="about-feature-card card ag-liquid-glass-soft" key={feature.title}>
                <span className="about-icon-tile" aria-hidden="true">
                  <Icon name={feature.icon} />
                </span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="about-protection-note" aria-label="Artwork protection limitations">
          No online platform can guarantee that digital artwork will never be copied, scraped, or misused. ArtGuard Hub
          aims to support artists through its available tools and commission workflows, while encouraging responsible
          use and respect for creative ownership.
        </aside>

        <section className="about-mission card ag-liquid-glass" aria-labelledby="about-mission-title">
          <div className="about-section-heading">
            <span className="about-kicker">Our purpose</span>
            <h2 id="about-mission-title">Our Mission</h2>
          </div>
          <p>
            Our mission is to help digital artists present their work with greater confidence and navigate commissions
            through clearer communication and more organized project workflows. We aim to support a creative community
            that respects artists&apos; work and encourages responsible collaboration between artists and clients.
          </p>
        </section>

        <section className="about-section" aria-labelledby="about-values-title">
          <div className="about-section-heading">
            <span className="about-kicker">Our guiding aspirations</span>
            <h2 id="about-values-title">What We Stand For</h2>
          </div>
          <div className="about-values-grid">
            {principles.map((principle) => (
              <article className="about-value-card card" key={principle.title}>
                <span className="about-value-mark" aria-hidden="true">
                  <Icon name="star" />
                </span>
                <h3>{principle.title}</h3>
                <p>{principle.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="about-app-info" aria-labelledby="about-app-info-title">
          <h2 id="about-app-info-title">App Information</h2>
          <p>ArtGuard Hub <span aria-hidden="true">·</span> Version {packageJson.version}</p>
        </footer>
      </div>
    </ScreenShell>
  );
}
