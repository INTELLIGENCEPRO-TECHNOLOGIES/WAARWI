import { useState } from 'react';
import { Package } from 'lucide-react';

type ShopLazyImageProps = {
  src: string | null;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  fallbackIconSize?: number;
};

export function ShopLazyImage({
  src,
  alt,
  className = '',
  fallbackClassName = '',
  fallbackIconSize = 32,
}: ShopLazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={`flex items-center justify-center ${fallbackClassName}`}
        role="img"
        aria-label={alt}
      >
        <Package
          style={{ width: fallbackIconSize, height: fallbackIconSize }}
          className="text-slate-300 opacity-40"
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={() => setErrored(true)}
      className={`shop-lazy-img ${loaded ? 'loaded' : ''} ${className}`}
    />
  );
}
