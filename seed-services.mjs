#!/usr/bin/env node

/**
 * Pixel8 Multimedia — Service Seed Script
 * 
 * Creates all 12 service documents in Sanity.
 * 
 * Usage:
 *   $env:SANITY_PROJECT_ID = "bqb4w421"
 *   $env:SANITY_DATASET = "production"
 *   $env:SANITY_API_TOKEN = "skYG2ilqNFvHNLqPFyPxoLoIl38gJFyL7nJDrnozDAxOWZwHbW8IN1lcvEVymV4FJID2PBYEpkdqFYZ6TWWF2yfYtNbCGMOA43RGNXVfkjIHlt5Z2aFszA3YA6dirYmYwTevSakxNhRhnaJbSttyiH9Johfuo31CaCGNLTizx9YRNG0Fc4jj"
 *   node seed-services.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET || 'production',
  token: process.env.SANITY_API_TOKEN,
  apiVersion: '2024-01-01',
  useCdn: false,
});

const services = [
  {
    title: 'Cartoonify Me!',
    slug: 'cartoonify-me',
    description: 'Turn your photo into a hand-crafted cartoon masterpiece in your favourite style — from The Simpsons and Rick & Morty to South Park, Anime, 3D Pixar, Steampunk, or Cyberpunk. Each image is custom-made to match your look, outfit, and background preferences.',
    steps: [
      { text: 'Upload a clear, front-facing photo (solo character works best).' },
      { text: 'Choose your preferred cartoon style or upgrade to include all styles in one download.' },
      { text: "We'll transform it into a vibrant, high-resolution artwork — delivered as a digital file, with optional print upgrades." },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 1,
  },
  {
    title: 'Stills to Reels',
    slug: 'stills-to-reels',
    description: 'Watch your favourite snapshot come alive! We animate your photo into a short cinematic scene — add subtle movement, background music, or even a voiceover for lifelike realism.',
    steps: [
      { text: 'Upload your photos (multiple angles recommended).' },
      { text: 'We structure your images into a cinematic sequence.' },
      { text: 'Choose your format: Enhanced Digital Stills or Full Animated Reel.' },
      { text: 'We add motion, transitions and optional music for a polished film-style finish.' },
      { text: 'Download your completed 16:9 HD reel securely.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: false,
    hasFileUpload: false,
    sortOrder: 2,
  },
  {
    title: 'The Missing Moment',
    slug: 'the-missing-moment',
    description: 'Add someone special into an existing photo — a loved one who has passed, a friend who missed your wedding, or a family member from afar. Each edit is created with care and realism, blending seamlessly into the original image.',
    steps: [
      { text: 'Upload clear images of the person/pet and the setting.' },
      { text: 'We carefully map lighting, scale and positioning for seamless realism.' },
      { text: 'Choose your format: Digital Still or Animated Memory Film.' },
      { text: 'We create a natural, emotional composite (with optional subtle cinematic movement).' },
      { text: 'Receive your finished 1080p creation via secure link.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 3,
  },
  {
    title: 'Past Perfect',
    slug: 'past-perfect',
    description: 'Restore treasured memories with professional photo repair and colourisation. We remove scratches, fading, and damage, then enhance detail and tone to bring every face and moment back to life.',
    steps: [
      { text: 'Upload your damaged or black-and-white photo.' },
      { text: "Tell us if you'd like full colourisation or clean restoration only." },
      { text: "We'll return a revitalised digital version — with optional print or canvas delivery." },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 4,
  },
  {
    title: 'Your Song Your Story',
    slug: 'your-song-your-story',
    description: 'Turn memories, milestones, or inside jokes into an original song. Choose your genre (pop, rock, acoustic, rap, country — anything goes) and share key details — names, dates, stories, or emotions — to inspire the lyrics.',
    steps: [
      { text: 'Provide a brief summary of who or what the song is about.' },
      { text: 'Select your preferred genre or artist vibe.' },
      { text: 'Our songwriting team crafts custom lyrics, melody, and professional production.' },
      { text: 'Receive your finished song as a digital file (MP3/WAV) — ready to play, share, or gift.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 5,
  },
  {
    title: 'Story Of Your Life',
    slug: 'story-of-your-life',
    description: 'Transform a lifetime of photographs into one beautifully crafted cinematic story. We recreate your most meaningful moments as living, moving scenes — carefully enhanced, expanded, and woven together into a powerful full-length animation. A timeless tribute to the journey that made you who you are.',
    steps: [
      { text: 'Upload a selection of your most meaningful photographs (the more you share, the richer the story).' },
      { text: 'Tell us about the person — key milestones, moments, and the emotion you want the piece to carry.' },
      { text: 'We structure your photos into a flowing cinematic narrative — enhanced, expanded, and woven together.' },
      { text: 'Choose your format: Digital Still Collage or Full Animated Story with background music and voiceover.' },
      { text: 'Receive your finished creation via secure download link.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 6,
  },
  {
    title: 'Back in Time',
    slug: 'back-in-time',
    description: 'See yourself evolve across eras. From the 1950s through to the 2000s, we redesign your photo to match the fashion, colour tone, and vibe of each decade.',
    steps: [
      { text: 'Upload one clear photo.' },
      { text: 'Receive multiple era-themed images in one download showing your transformation through time.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 7,
  },
  {
    title: 'The Day I Met...',
    slug: 'the-day-i-met',
    description: "Ever wished you'd been there when it happened? The Day I Met... creates a believable, cinematic image of you alongside your favourite celebrity — seamlessly merged as if the moment really took place.",
    extendedDescription: "Whether it's a casual meet-and-greet, a backstage encounter, or a once-in-a-lifetime photo opportunity, each image is carefully crafted to look natural, authentic, and utterly convincing — without ever claiming it actually happened. Perfect for keepsakes, gifts, or just having a little fun with fantasy.",
    importantNote: 'All images created through The Day I Met... are fictional, artistic recreations made for entertainment and personal use only. They are not endorsements, real encounters, or affiliated with the celebrity depicted.',
    steps: [
      { text: 'Upload a clear photo of yourself.' },
      { text: 'Tell us which celebrity you\'d like to "meet".' },
      { text: 'Choose the vibe (casual, red carpet, backstage, studio, etc.).' },
      { text: 'We seamlessly merge you into the scene with cinematic realism.' },
      { text: 'Receive your image as a high-resolution digital download.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 8,
  },
  {
    title: 'Scene Stealer',
    slug: 'scene-stealer',
    description: "Become the star of cinema's most iconic scenes. From action epics to romantic classics, we replace the main character with YOU — flawlessly integrated into the set, lighting, and mood.",
    steps: [
      { text: 'Upload a high-quality portrait-style image.' },
      { text: 'Tell us the movie you want to appear in.' },
      { text: 'Choose your format: Digital Still or Animated Film Sequence.' },
      { text: 'We craft a photorealistic edit (and optional short animation) where you steal the scene.' },
      { text: 'Receive your final 1080p cinematic creation via secure download.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 9,
  },
  {
    title: 'Crayon To Creation',
    slug: 'crayon-to-creation',
    description: "Turn your child's imagination into something truly special. Crayon To Creation brings hand-drawn pictures to life — transforming your child's artwork into vibrant digital characters and magical scenes while preserving the charm, personality, and creativity of the original drawing.",
    extendedDescription: 'From fridge-door masterpieces to fantasy heroes, this is a keepsake that celebrates creativity and turns imagination into art.',
    steps: [
      { text: "Upload a clear image of your child's drawing." },
      { text: 'We transform it into a detailed cinematic 3D character.' },
      { text: 'Choose your format: Digital Still or Animated Adventure.' },
      { text: 'We place the character into an immersive scene (with optional animated action).' },
      { text: 'Download your finished 16:9 HD creation securely.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 10,
  },
  {
    title: 'Star Power',
    slug: 'star-power',
    description: 'Turn your child or pet into the star of their very own blockbuster. With Star Power, we create cinematic movie-poster-style artwork that places the ones you love most at the heart of the action — complete with dramatic lighting, epic backdrops, and big-screen energy.',
    extendedDescription: 'Perfect as a gift, bedroom feature, or keepsake, each creation looks like a genuine film poster — starring your star.',
    steps: [
      { text: 'Upload a clear photo of your child or pet.' },
      { text: 'Choose a movie style or theme (action, animation, fantasy, adventure, etc.).' },
      { text: 'We design a cinematic poster featuring them as the lead.' },
      { text: 'Receive your artwork as a digital download or Poster / Canvas print.' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 11,
  },
  {
    title: 'Prankz!',
    slug: 'prankz',
    description: 'Prank your friends with images that look way too real to ignore. Prankz lets you commission realistic, fictional photos designed to spark confusion, panic, laughter — and the inevitable "WHAT IS THIS?!" message.',
    extendedDescription: 'From awkward situations to full-blown "explain yourself immediately" moments, Prankz creations are made for harmless fun, big reactions, and unforgettable reveals.',
    importantNote: 'All Prankz images are fictional creations for entertainment only. We do not create illegal, explicit, or harmful content, and all examples are designed to be harmless, reversible, and prank-safe.',
    steps: [
      { text: 'Upload clear, high-quality images and tell us your prank idea.' },
      { text: 'We develop your concept into cinematic scenes with setup, escalation and reveal.' },
      { text: 'Choose your format: Digital Still or Animated Short Film.' },
      { text: 'We craft a photorealistic edit (and optional short animation) where the prank comes to life.' },
      { text: 'Receive your final 16:9 HD creation via secure download link.' },
      { text: 'Send it... then wait for the reaction 😈' },
    ],
    hasDigitalDelivery: true,
    hasPrintOrder: true,
    hasFileUpload: true,
    sortOrder: 12,
  },
];

async function seed() {
  console.log('🛠️  Pixel8 Multimedia — Service Seed Script');
  console.log('==========================================\n');

  for (const svc of services) {
    const doc = {
      _type: 'service',
      title: svc.title,
      slug: { _type: 'slug', current: svc.slug },
      description: svc.description,
      extendedDescription: svc.extendedDescription || undefined,
      importantNote: svc.importantNote || undefined,
      steps: svc.steps.map((s, i) => ({
        _type: 'object',
        _key: `step-${i}`,
        text: s.text,
      })),
      hasDigitalDelivery: svc.hasDigitalDelivery,
      hasPrintOrder: svc.hasPrintOrder,
      hasFileUpload: svc.hasFileUpload,
      sortOrder: svc.sortOrder,
    };

    await client.create(doc);
    console.log(`   ✅ ${svc.title}`);
  }

  console.log(`\n🎉 Done! ${services.length} services created.`);
  console.log('   Now add gallery images and YouTube IDs in Sanity Studio.');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
