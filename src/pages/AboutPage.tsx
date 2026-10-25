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
    description: 'Manage original uploads and portfolio previews. Optional visual protections may discourage casual copying, but cannot prevent every copy or scrape.',
  },
  {
    icon: 'compass',
    title: 'Find Artists and Request Commissions',
    description: 'Explore portfolios and connect through commission requests. Verification does not guarantee identity or transaction safety.',
  },
  {
    icon: 'chat',
    title: 'Keep Commission Conversations Organized',
    description: 'Message directly and share artwork or attachments. Blocking is available, but chat is not scam detection.',
  },
  {
    icon: 'check-circle',
    title: 'Manage Commission Progress',
    description: 'Track milestones, share deliverables, and review project approvals.',
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
              ArtGuard Hub helps digital artists present their work and navigate commissions with greater confidence.
              Private originals, portfolio previews, direct communication, and project workflows bring practical tools
              together, but cannot prevent every form of copying or misuse.
            </p>
          </div>
        </section>

        <section className="about-section about-why" aria-labelledby="about-why-title">
          <div className="about-section-heading">
            <span className="about-kicker">The challenges artists face</span>
            <h2 id="about-why-title">Why ArtGuard Hub Exists</h2>
          </div>
          <p>
            Digital artists face AI scraping, unauthorized artwork reuse, impersonation, and commission scams. ArtGuard
            Hub helps artists navigate these risks through tools for presenting artwork and managing commissions.
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
            We aim to help digital artists present their work with greater confidence and manage commissions through
            clearer communication and organized workflows—while encouraging respect for creative ownership and
            responsible collaboration.
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
