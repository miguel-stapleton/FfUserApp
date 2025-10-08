const fs = require('fs');
const path = require('path');

// Simple SVG icon template for Fresh Faced
const createSVG = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#ec4899" rx="${size * 0.1}"/>
  <circle cx="${size * 0.5}" cy="${size * 0.35}" r="${size * 0.15}" fill="white"/>
  <path d="M ${size * 0.25} ${size * 0.6} Q ${size * 0.5} ${size * 0.8} ${size * 0.75} ${size * 0.6}" 
        stroke="white" stroke-width="${size * 0.03}" fill="none" stroke-linecap="round"/>
  <text x="${size * 0.5}" y="${size * 0.9}" text-anchor="middle" fill="white" 
        font-family="Arial, sans-serif" font-size="${size * 0.08}" font-weight="bold">FF</text>
</svg>`;

// Icon sizes needed
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate SVG icons (as fallback)
sizes.forEach(size => {
  const svg = createSVG(size);
  const filename = `icon-${size}x${size}.svg`;
  fs.writeFileSync(path.join(publicDir, filename), svg);
  console.log(`Generated ${filename}`);
});

console.log('SVG icons generated. For production, convert these to PNG using an online converter or imagemagick.');
console.log('Command example: convert icon-192x192.svg icon-192x192.png');
