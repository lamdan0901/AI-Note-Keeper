## Design System: AI Note Keeper

### Pattern
- **Name:** Horizontal Scroll Journey
- **Conversion Focus:** Immersive product discovery. High engagement. Keep navigation visible.
28,Bento Grid Showcase,bento
- **CTA Placement:** Floating Sticky CTA or End of Horizontal Track
- **Color Strategy:** Continuous palette transition. Chapter colors. Progress bar #000000.
- **Sections:** 1. Intro (Vertical), 2. The Journey (Horizontal Track), 3. Detail Reveal, 4. Vertical Footer

### Style
- **Name:** Vibrant & Block-based
- **Keywords:** Bold, energetic, playful, block layout, geometric shapes, high color contrast, duotone, modern, energetic
- **Best For:** Startups, creative agencies, gaming, social media, youth-focused, entertainment, consumer
- **Performance:** ⚡ Good | **Accessibility:** ◐ Ensure WCAG

### Colors
| Role | Hex |
|------|-----|
| Primary | #3B82F6 |
| Secondary | #60A5FA |
| CTA | #F97316 |
| Background | #F8FAFC |
| Text | #1E293B |

*Notes: Clear hierarchy + functional colors*

### Typography
- **Heading:** Plus Jakarta Sans
- **Body:** Plus Jakarta Sans
- **Mood:** friendly, modern, saas, clean, approachable, professional
- **Best For:** SaaS products, web apps, dashboards, B2B, productivity tools
- **Google Fonts:** https://fonts.google.com/share?selection.family=Plus+Jakarta+Sans:wght@300;400;500;600;700
- **CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
```

### Key Effects
Large sections (48px+ gaps), animated patterns, bold hover (color shift), scroll-snap, large type (32px+), 200-300ms

### Avoid (Anti-patterns)
- Generic layout
- Hidden earnings

### Pre-Delivery Checklist
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px

