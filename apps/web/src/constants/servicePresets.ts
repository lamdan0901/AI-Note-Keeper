import type { SubscriptionCategory } from '../../../../packages/shared/types/subscription';

export type ServicePreset = {
  name: string;
  category: SubscriptionCategory;
  defaultColor: string;
};

export const SERVICE_PRESETS: ServicePreset[] = [
  // Streaming
  { name: 'Netflix', category: 'streaming', defaultColor: '#E50914' },
  { name: 'Disney+', category: 'streaming', defaultColor: '#113CCF' },
  { name: 'Hulu', category: 'streaming', defaultColor: '#1CE783' },
  { name: 'HBO Max', category: 'streaming', defaultColor: '#5822B4' },
  { name: 'Amazon Prime Video', category: 'streaming', defaultColor: '#00A8E0' },
  { name: 'Apple TV+', category: 'streaming', defaultColor: '#555555' },
  // Music
  { name: 'Spotify', category: 'music', defaultColor: '#1DB954' },
  { name: 'Apple Music', category: 'music', defaultColor: '#FC3C44' },
  { name: 'YouTube Music', category: 'music', defaultColor: '#FF0000' },
  { name: 'Tidal', category: 'music', defaultColor: '#000000' },
  // Tools / Dev
  { name: 'GitHub', category: 'tools', defaultColor: '#181717' },
  { name: 'JetBrains', category: 'tools', defaultColor: '#FF318C' },
  { name: 'Adobe Creative Cloud', category: 'tools', defaultColor: '#FF0000' },
  { name: 'Figma', category: 'tools', defaultColor: '#F24E1E' },
  // Productivity
  { name: 'Notion', category: 'productivity', defaultColor: '#000000' },
  { name: 'Todoist', category: 'productivity', defaultColor: '#DB4035' },
  { name: 'Microsoft 365', category: 'productivity', defaultColor: '#D83B01' },
  // Cloud / Storage
  { name: 'Google One', category: 'cloud', defaultColor: '#4285F4' },
  { name: 'Dropbox', category: 'cloud', defaultColor: '#0061FF' },
  { name: 'iCloud+', category: 'cloud', defaultColor: '#3478F6' },
  // Gaming
  { name: 'Xbox Game Pass', category: 'gaming', defaultColor: '#107C10' },
  { name: 'PlayStation Plus', category: 'gaming', defaultColor: '#003791' },
  // News / Reading
  { name: 'The New York Times', category: 'news', defaultColor: '#000000' },
  { name: 'Medium', category: 'news', defaultColor: '#000000' },
];
