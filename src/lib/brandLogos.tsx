// SVG logos for well-known automotive brands — rendered inline, no external dependencies.

const logos: Record<string, JSX.Element> = {
  Toyota: (
    <svg viewBox="0 0 198 76" xmlns="http://www.w3.org/2000/svg" fill="currentColor" className="w-full h-full">
      <ellipse cx="99" cy="38" rx="97" ry="36" fill="none" stroke="#EB0A1E" strokeWidth="6"/>
      <ellipse cx="99" cy="38" rx="57" ry="24" fill="none" stroke="#EB0A1E" strokeWidth="6"/>
      <ellipse cx="99" cy="16" rx="35" ry="14" fill="#EB0A1E"/>
    </svg>
  ),
  BMW: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#1C3971" stroke="#1C3971" strokeWidth="1"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="white" strokeWidth="4"/>
      <path d="M50 10 A40 40 0 0 1 90 50 L50 50 Z" fill="white"/>
      <path d="M50 50 A40 40 0 0 1 10 50 L50 50 Z" fill="white"/>
      <path d="M10 50 A40 40 0 0 1 50 10 L50 50 Z" fill="#1C3971"/>
      <path d="M90 50 A40 40 0 0 1 50 90 L50 50 Z" fill="#1C3971"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="white" strokeWidth="2"/>
    </svg>
  ),
  Mercedes: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="white" stroke="#999" strokeWidth="2"/>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#999" strokeWidth="1"/>
      <line x1="50" y1="6" x2="50" y2="50" stroke="#999" strokeWidth="3"/>
      <line x1="50" y1="50" x2="12" y2="72" stroke="#999" strokeWidth="3"/>
      <line x1="50" y1="50" x2="88" y2="72" stroke="#999" strokeWidth="3"/>
    </svg>
  ),
  Volkswagen: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#00205B"/>
      <circle cx="50" cy="50" r="34" fill="none" stroke="white" strokeWidth="3"/>
      <text x="50" y="62" textAnchor="middle" fill="white" fontSize="42" fontFamily="Arial" fontWeight="bold">VW</text>
    </svg>
  ),
  Audi: (
    <svg viewBox="0 0 280 80" xmlns="http://www.w3.org/2000/svg">
      {[30,90,150,210].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy="40" r="28" fill="none" stroke="#BB0A21" strokeWidth="7"/>
        </g>
      ))}
    </svg>
  ),
  Peugeot: (
    <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,5 78,30 78,60 50,85 22,60 22,30" fill="none" stroke="#0053A0" strokeWidth="4"/>
      <text x="50" y="70" textAnchor="middle" fill="#0053A0" fontSize="28" fontFamily="Arial" fontWeight="900">P</text>
      <line x1="50" y1="85" x2="50" y2="115" stroke="#0053A0" strokeWidth="4"/>
      <line x1="30" y1="115" x2="70" y2="115" stroke="#0053A0" strokeWidth="4"/>
    </svg>
  ),
  Renault: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,5 95,50 50,95 5,50" fill="#FFCC00"/>
      <polygon points="50,20 77,50 50,80 23,50" fill="#FFCC00" stroke="#FFCC00"/>
      <polygon points="50,30 68,50 50,70 32,50" fill="white"/>
    </svg>
  ),
  Citroën: (
    <svg viewBox="0 0 160 80" xmlns="http://www.w3.org/2000/svg">
      <path d="M80,10 L140,40 L80,55 Z" fill="#C8102E" stroke="none"/>
      <path d="M80,25 L140,55 L80,70 Z" fill="#C8102E" stroke="none"/>
      <path d="M80,10 L20,40 L80,55 Z" fill="#C8102E" stroke="none"/>
      <path d="M80,25 L20,55 L80,70 Z" fill="#C8102E" stroke="none"/>
    </svg>
  ),
  Ford: (
    <svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="100" cy="40" rx="98" ry="38" fill="#003478"/>
      <text x="100" y="54" textAnchor="middle" fill="white" fontSize="46" fontFamily="'Times New Roman',serif" fontStyle="italic" fontWeight="bold">Ford</text>
    </svg>
  ),
  Honda: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="90" height="90" rx="8" fill="#CC0000"/>
      <text x="50" y="72" textAnchor="middle" fill="white" fontSize="72" fontFamily="Arial" fontWeight="bold">H</text>
    </svg>
  ),
  Hyundai: (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="40" rx="58" ry="38" fill="#002C5F"/>
      <text x="60" y="53" textAnchor="middle" fill="white" fontSize="52" fontFamily="Arial" fontStyle="italic" fontWeight="bold">H</text>
    </svg>
  ),
  Kia: (
    <svg viewBox="0 0 180 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="176" height="56" rx="6" fill="#05141F"/>
      <text x="90" y="44" textAnchor="middle" fill="white" fontSize="38" fontFamily="Arial" fontWeight="bold" letterSpacing="8">KIA</text>
    </svg>
  ),
  Nissan: (
    <svg viewBox="0 0 200 70" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="196" height="66" rx="6" fill="#C3002F"/>
      <text x="100" y="46" textAnchor="middle" fill="white" fontSize="30" fontFamily="Arial" fontWeight="bold" letterSpacing="4">NISSAN</text>
    </svg>
  ),
  Mazda: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="white" stroke="#BBBCBC" strokeWidth="2"/>
      <ellipse cx="50" cy="42" rx="22" ry="28" fill="none" stroke="#A0202A" strokeWidth="6"/>
      <ellipse cx="35" cy="52" rx="18" ry="14" fill="#A0202A"/>
      <ellipse cx="65" cy="52" rx="18" ry="14" fill="#A0202A"/>
    </svg>
  ),
  Mitsubishi: (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,5 70,40 50,40" fill="#ED1A3B"/>
      <polygon points="10,70 30,35 50,70" fill="#ED1A3B"/>
      <polygon points="90,70 70,35 50,70" fill="#ED1A3B"/>
    </svg>
  ),
  Suzuki: (
    <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="116" height="76" rx="4" fill="#E2001A"/>
      <text x="60" y="54" textAnchor="middle" fill="white" fontSize="42" fontFamily="Arial" fontWeight="bold">S</text>
    </svg>
  ),
  Dacia: (
    <svg viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="156" height="56" rx="4" fill="#002B5C"/>
      <text x="80" y="40" textAnchor="middle" fill="white" fontSize="24" fontFamily="Arial" fontWeight="bold" letterSpacing="3">DACIA</text>
    </svg>
  ),
  Chevrolet: (
    <svg viewBox="0 0 160 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="25" width="156" height="30" rx="2" fill="#C8A84B"/>
      <rect x="28" y="2" width="44" height="76" rx="2" fill="#C8A84B"/>
      <rect x="36" y="10" width="28" height="60" rx="1" fill="white"/>
    </svg>
  ),
  Isuzu: (
    <svg viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="156" height="56" rx="4" fill="#CC0000"/>
      <text x="80" y="40" textAnchor="middle" fill="white" fontSize="24" fontFamily="Arial" fontWeight="bold" letterSpacing="2">ISUZU</text>
    </svg>
  ),
  'Land Rover': (
    <svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="196" height="56" rx="4" fill="#005A2B"/>
      <text x="100" y="36" textAnchor="middle" fill="white" fontSize="14" fontFamily="Arial" fontWeight="bold" letterSpacing="2">LAND ROVER</text>
    </svg>
  ),
};

/** Returns an inline SVG logo for the given brand name, or null if unknown */
export function getBrandLogo(name: string): JSX.Element | null {
  // Normalize: "Mercedes-Benz" → "Mercedes"
  const key = Object.keys(logos).find(k =>
    name.toLowerCase().startsWith(k.toLowerCase()) ||
    k.toLowerCase().startsWith(name.toLowerCase())
  );
  return key ? logos[key] : null;
}
