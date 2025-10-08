const fs = require('fs');
const path = require('path');

// Create a simple 1x1 PNG data (base64 encoded)
// This is a minimal valid PNG file that browsers can display
const createMinimalPNG = () => {
  // Minimal 1x1 transparent PNG in base64
  const pngData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77yQAAAABJRU5ErkJggg==';
  return Buffer.from(pngData, 'base64');
};

// Create a colored PNG (this creates a simple colored square)
const createColoredPNG = (size) => {
  // Create SVG and convert to data URL approach
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#ec4899" rx="${Math.floor(size * 0.1)}"/>
    <circle cx="${size/2}" cy="${size * 0.35}" r="${size * 0.15}" fill="white"/>
    <path d="M ${size * 0.25} ${size * 0.6} Q ${size * 0.5} ${size * 0.8} ${size * 0.75} ${size * 0.6}" 
          stroke="white" stroke-width="${size * 0.03}" fill="none" stroke-linecap="round"/>
    <text x="${size/2}" y="${size * 0.9}" text-anchor="middle" fill="white" 
          font-family="Arial, sans-serif" font-size="${size * 0.08}" font-weight="bold">FF</text>
  </svg>`;
  
  return Buffer.from(svg);
};

// Icon sizes needed
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Creating PWA icons...');

// Create SVG files that browsers can use as fallback
sizes.forEach(size => {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#ec4899" rx="${Math.floor(size * 0.1)}"/>
    <circle cx="${size/2}" cy="${size * 0.35}" r="${size * 0.15}" fill="white"/>
    <path d="M ${size * 0.25} ${size * 0.6} Q ${size * 0.5} ${size * 0.8} ${size * 0.75} ${size * 0.6}" 
          stroke="white" stroke-width="${size * 0.03}" fill="none" stroke-linecap="round"/>
    <text x="${size/2}" y="${size * 0.9}" text-anchor="middle" fill="white" 
          font-family="Arial, sans-serif" font-size="${size * 0.08}" font-weight="bold">FF</text>
  </svg>`;
  
  // Save as SVG (browsers can use SVG in manifest)
  const svgFilename = `icon-${size}x${size}.svg`;
  fs.writeFileSync(path.join(publicDir, svgFilename), svg);
  
  // Create a minimal PNG placeholder
  const pngFilename = `icon-${size}x${size}.png`;
  const minimalPng = createMinimalPNG();
  fs.writeFileSync(path.join(publicDir, pngFilename), minimalPng);
  
  console.log(`Created ${svgFilename} and ${pngFilename}`);
});

console.log('\nIcons created successfully!');
console.log('Note: PNG files are minimal placeholders. SVG files contain the actual design.');
console.log('For production, consider using proper PNG conversion tools or online converters.');
