// import-products.mjs
// Creates Pixel8 store products in Sanity for every Products\<Subject>\Style X.png
// that doesn't already exist on the site. Idempotent: re-running only adds what's missing.
//
// Setup (once, in the tools folder):
//   npm init -y
//   npm install @sanity/client
//   $env:SANITY_TOKEN = "<your Sanity write token>"
// Run:
//   node import-products.mjs --dry-run
//   node import-products.mjs

import { createClient } from '@sanity/client'
import fs from 'node:fs'
import path from 'node:path'

const PRODUCTS_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products'
const DRY_RUN = process.argv.includes('--dry-run')

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
})

// ---- Category assignment (folder name -> store category) ---------------------
const music = ['Adam Ant','Adele','Brandon Flowers','David Bowie','Elton John','Frank Sinatra','Freddie Mercury',
  'George Michael','Harry Styles','Janis Joplin','Jim Morrison','Joey Ramone','Kylie','Liam Gallagher','Madonna',
  'Mick Jagger','Notorious BIG','Olivia Dean','Ozzy Osbourne','Paul Weller','Robbie Williams','Sabrina Carpenter',
  'Stevie Wonder','Taylor Swift','The Beatles','Tupac']
const sport = ['Ayrton Senna','Bobby Moore','David Beckham','Eric Cantona','George Best','Jude Bellingham','Kobe Bryant',
  'Lionel Messi','Maradona','Mike Tyson','Pele','Rafa Nadal','Roger Federer','Ronaldo','Thierry Henry','Tyson Fury','Usain Bolt']
const animations = ['Buzz Lightyear','Captain Caveman','Dastardly and Muttley','Droopy','Elmer Fudd','Fred Flintstone','Goku',
  'He-Man','Homer Simpson','Hong Kong Fooey','Penelope Pitstop','Peter Griffin','South Park','Taz','The Minions','Woody',
  'Baby Groot']
const tvMovies = ['Baby Yoda','Bill and Ted','Charlie Chaplin The Tramp','Dorothy Wizard of Oz','E.T','Edward Scissorhands',
  'Eleven Stranger Things','Ferris Bueller','Forrest Gump','Fozzie Bear','Frankensteins monster','Gandalf','Ghostbusters',
  'Guillermo and Nandor','Hannibal Lecter','Inigo Montoya','Jack Torrance','James Dean','Jay and Silent Bob','Kill Bill The Bride',
  'Mad Max','Marilyn Monroe','Maximus','Neo','Neo and Morpheus','Rocky Balboa','Snake Plissken','T-800','Tony Montana',
  'Travis Bickle','Wednesday Addams','Willy Wonka','Hans Solo','Han Solo','Rocket Guardians Of The Galaxy']
const categoryOf = (name) =>
  music.includes(name) ? 'music' : sport.includes(name) ? 'sport' :
  animations.includes(name) ? 'animations' : tvMovies.includes(name) ? 'tv-movies' : null

// Accent colours already in use on the site, rotated by style letter
const ACCENTS = ['#FF00FF','#E0E0E0','#00E5FF','#FFD600','#FF6B35','#76FF03','#7C4DFF','#FF1744','#81D4FA','#424242']

const PRICES = { poster: { small: 9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery: { small: 29.99, medium: 35.99, large: 47.99 } }
const SIZES = { small: '12x12', medium: '16x16', large: '20x20' }

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ---- Gather work ----------------------------------------------------------------
const existing = new Set(await client.fetch('*[_type=="product"].slug.current'))
const work = []
const unknownCategory = new Set()

for (const folder of fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true })) {
  if (!folder.isDirectory() || folder.name.startsWith('_')) continue
  const subject = folder.name
  const dir = path.join(PRODUCTS_DIR, subject)
  for (const file of fs.readdirSync(dir)) {
    const m = /^Style ([A-J])\.(png|jpg|jpeg)$/i.exec(file)
    if (!m) continue
    const letter = m[1].toUpperCase()
    const slug = `${slugify(subject)}-style-${letter.toLowerCase()}`
    if (existing.has(slug)) continue
    let category = categoryOf(subject)
    if (!category) { category = 'miscellaneous'; unknownCategory.add(subject) }
    work.push({ subject, letter, slug, category, imagePath: path.join(dir, file) })
  }
}

// Only import subjects that have the full set of 10 designs
const perSubject = new Map()
for (const w of work) perSubject.set(w.subject, (perSubject.get(w.subject) || 0) + 1)
const incomplete = [...perSubject].filter(([, n]) => n < 10).map(([s, n]) => `${s} (${n})`)
if (incomplete.length) console.log('Skipping subjects without all 10 designs:', incomplete.join(', '))
const complete = work.filter(w => perSubject.get(w.subject) === 10)
work.length = 0
work.push(...complete)

console.log(`${work.length} products to create across ${new Set(work.map(w => w.subject)).size} subjects`)
if (unknownCategory.size) console.log('No category rule (defaulting to miscellaneous):', [...unknownCategory].join(', '))
if (DRY_RUN) { work.forEach(w => console.log(`  ${w.slug.padEnd(40)} ${w.category}`)); process.exit(0) }
if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set'); process.exit(1) }

// ---- Create -----------------------------------------------------------------------
let done = 0, failed = 0
for (const w of work) {
  const title = `${w.subject} — Option ${w.letter}`
  try {
    const asset = await client.assets.upload('image', fs.createReadStream(w.imagePath), { filename: `${w.slug}.png` })
    await client.createIfNotExists({
      _id: `product-${w.slug}`,
      _type: 'product',
      title,
      slug: { _type: 'slug', current: w.slug },
      style: `style-${w.letter.toLowerCase()}`,
      category: w.category,
      tags: [w.category, `style-${w.letter.toLowerCase()}`],
      accentColor: ACCENTS[w.letter.charCodeAt(0) - 65],
      featured: false,
      sortOrder: 0,
      prices: PRICES,
      sizes: SIZES,
      images: [{ _key: 'img-0', _type: 'image', alt: `${w.subject} Option ${w.letter} wall art by Pixel8 Multimedia`,
        asset: { _type: 'reference', _ref: asset._id } }],
      description: [{ _key: 'desc-0', _type: 'block', style: 'normal', markDefs: [],
        children: [{ _key: 'span-0', _type: 'span', marks: [],
          text: `${w.subject} reimagined in our exclusive Option ${w.letter} design. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.` }] }],
      seo: { metaTitle: `${w.subject} Wall Art — Option ${w.letter} | Pixel8 Multimedia`,
        metaDescription: `${w.subject} — exclusive Option ${w.letter} design from Pixel8. Poster prints and canvas made to order in the UK.` },
    })
    done++
    process.stdout.write(`\r${done}/${work.length} created`)
  } catch (err) {
    failed++
    console.error(`\nFAILED ${w.slug}: ${err.message}`)
  }
}
console.log(`\nDone: ${done} created, ${failed} failed`)
