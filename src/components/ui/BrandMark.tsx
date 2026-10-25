import logoNavy from '../../assets/brand/logo-navy.png';
import logoYellow from '../../assets/brand/logo-yellow.png';
import logoWhite from '../../assets/brand/logo-white.png';

export type BrandLogoVariant = 'navy' | 'yellow' | 'white';

const LOGO_SRC: Record<BrandLogoVariant, string> = {
  navy: logoNavy,
  yellow: logoYellow,
  white: logoWhite,
};

interface BrandMarkProps {
  /** Fixed logo color to use — pick whichever variant contrasts best against this spot's (theme-invariant) background. */
  variant?: BrandLogoVariant;
  /**
   * For a badge whose background flips between a light and a dark surface
   * across the app's light/dark theme (see ThemeContext + [data-theme] on
   * <html>), render both variants and let CSS show the right one — see the
   * `.brand-mark-light` / `.brand-mark-dark` rules in global.css.
   * Takes priority over `variant` when set.
   */
  themed?: { light: BrandLogoVariant; dark: BrandLogoVariant };
  className?: string;
  alt?: string;
}

/** The ArtGuard Hub shield logo mark — see the 3 provided PNGs (navy/yellow/white) in src/assets/brand. */
export function BrandMark({ variant = 'navy', themed, className = '', alt = 'ArtGuard Hub' }: BrandMarkProps) {
  if (themed) {
    return (
      <>
        <img src={LOGO_SRC[themed.light]} alt={alt} className={`brand-mark-light ${className}`.trim()} />
        <img src={LOGO_SRC[themed.dark]} alt={alt} className={`brand-mark-dark ${className}`.trim()} />
      </>
    );
  }
  return <img src={LOGO_SRC[variant]} alt={alt} className={className} />;
}
