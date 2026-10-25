import { useNavigate } from 'react-router-dom';
import { Icon } from '../assets/icons';
import { IconButton } from '../components/ui/IconButton';
import { ScreenShell } from '../components/ui/ScreenShell';
import packageJson from '../../package.json';
import './AboutPage.css';

const features = [
  {
    icon: 'compass',
    title: 'Discover Artists and Artwork',
    description: 'Explore artist profiles, portfolios, and artwork to find creators whose style matches your vision.',
  },
  {
    icon: 'palette',
    title: 'Request Art Commissions',
    description: 'Connect with artists and organize custom artwork requests around your project requirements.',
  },
  {
    icon: 'chat',
    title: 'Collaborate in One Place',
    description: 'Communicate through chat, share artwork, and keep important project conversations together.',
  },
  {
    icon: 'check-circle',
    title: 'Manage Commission Progress',
    description: 'Follow project milestones, deliverables, and approval progress through the commission workspace.',
  },
] as const;

const principles = [
  {
    title: 'Artist-first',
    description: 'Give artists a space to showcase their talent and portfolios.',
  },
  {
    title: 'Meaningful Collaboration',
    description: 'Help artists and clients communicate and organize their creative projects.',
  },
  {
    title: 'Respect for Creative Work',
    description: 'Encourage responsible collaboration and respect for artwork and attribution.',
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
            <Icon name="palette" />
          </div>
          <div className="about-hero-copy">
            <p className="about-eyebrow">A creative space for artists and clients</p>
            <h1 id="about-title">About ArtGuard Hub</h1>
            <p className="about-tagline">Where creativity meets collaboration.</p>
            <p className="about-introduction">
              ArtGuard Hub is a digital art marketplace designed to connect artists and clients in one creative space.
              Artists can showcase their work and connect with potential clients, while clients can discover creators,
              request commissions, and collaborate on creative projects.
            </p>
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-features-title">
          <div className="about-section-heading">
            <span className="about-kicker">The creative process</span>
            <h2 id="about-features-title">What You Can Do Here</h2>
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

        <section className="about-mission card ag-liquid-glass" aria-labelledby="about-mission-title">
          <div className="about-section-heading">
            <span className="about-kicker">Our purpose</span>
            <h2 id="about-mission-title">Our Mission</h2>
          </div>
          <p>
            Our mission is to create an accessible, artist-centered space for digital art commissions—helping artists
            showcase their creativity, connect with clients, and organize their work while making it easier for clients
            to discover and collaborate with talented creators.
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
