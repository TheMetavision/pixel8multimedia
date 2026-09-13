// add-design-names.mjs
// Adds the per-design nickname (e.g. "Dream Glow") to the description of new products,
// following the existing pattern: A Glow, B Minimal, C Place Year, D Eight-Bit, E Burst,
// F Pop, G Painted, H Shadow, I Geometry, J Stencil.
//
//   node --env-file=.env scripts/add-design-names.mjs --dry-run
//   node --env-file=.env scripts/add-design-names.mjs

import { createClient } from '@sanity/client'

const DRY_RUN = process.argv.includes('--dry-run')
const client = createClient({ projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN, useCdn: false })

// subject -> [theme (A,H), theme2 (B,I), theme3 (E), short name (D,F,J), place+year (C), painted word (G)]
const T = {
  'Adele':                    ['Velvet', 'Voice', 'Chasing', 'Adele', 'Tottenham 08', 'Diva'],
  'Ayrton Senna':             ['Helmet', 'Apex', 'Podium', 'Senna', 'Monaco 88', 'Legend'],
  'Buzz Lightyear':           ['Infinity', 'Wings', 'Rocket', 'Buzz', 'Star Command 95', 'Ranger'],
  'Charlie Chaplin The Tramp':['Tramp', 'Bowler', 'Silent', 'Chaplin', 'Hollywood 25', 'Tramp'],
  'David Beckham':            ['Becks', 'Seven', 'Free Kick', 'Beckham', 'Old Trafford 99', 'Seven'],
  'David Bowie':              ['Stardust', 'Lightning', 'Ziggy', 'Bowie', 'Hammersmith 73', 'Starman'],
  'Dorothy Wizard of Oz':     ['Ruby', 'Yellow Brick', 'Kansas', 'Dorothy', 'Oz 39', 'Dorothy'],
  'E.T':                      ['Phone Home', 'Bike', 'Moonlit', 'E.T.', 'Suburbia 82', 'Visitor'],
  'Edward Scissorhands':      ['Scissor', 'Topiary', 'Snowfall', 'Edward', 'Suburbia 90', 'Edward'],
  'Eleven Stranger Things':   ['Eggo', 'Upside Down', 'Psychic', 'Eleven', 'Hawkins 83', 'Eleven'],
  'Elmer Fudd':               ['Wabbit', 'Hunter', 'Shush', 'Elmer', 'Warner 40', 'Fudd'],
  'Elton John':               ['Rocket Man', 'Glasses', 'Piano', 'Elton', 'Dodger Stadium 75', 'Rocketman'],
  'Forrest Gump':             ['Bench', 'Running', 'Feather', 'Forrest', 'Alabama 94', 'Gump'],
  'Fozzie Bear':              ['Wocka', 'Hat', 'Punchline', 'Fozzie', 'Muppet Theatre 76', 'Fozzie'],
  'Frank Sinatra':            ['Blue Eyes', 'Fedora', 'Swing', 'Sinatra', 'Las Vegas 60', 'Crooner'],
  'Frankensteins monster':    ['Monster', 'Bolt', 'Lightning', 'Frankenstein', 'Ingolstadt 31', 'Monster'],
  'Fred Flintstone':          ['Yabba Dabba', 'Bedrock', 'Stone Age', 'Fred', 'Bedrock 60', 'Flintstone'],
  'Freddie Mercury':          ['Mercury', 'Champion', 'Wembley', 'Freddie', 'Wembley 86', 'Mercury'],
  'Goku':                     ['Saiyan', 'Kamehameha', 'Super Saiyan', 'Goku', 'Namek 89', 'Saiyan'],
  'Han Solo':                 ['Falcon', 'Smuggler', 'Kessel', 'Han', 'Mos Eisley 77', 'Solo'],
  'Harry Styles':             ['Harry', 'Watermelon', 'Fine Line', 'Harry', 'Holmes Chapel 10', 'Styles'],
  'He-Man':                   ['Grayskull', 'Power Sword', 'Eternia', 'He-Man', 'Eternia 83', 'Master'],
  'Inigo Montoya':            ['Montoya', 'Rapier', 'Revenge', 'Inigo', 'Florin 87', 'Swordsman'],
  'Jack Torrance':            ['Overlook', 'Axe', 'Redrum', 'Torrance', 'Overlook 80', 'Torrance'],
  'James Dean':               ['Rebel', 'Denim', 'Giant', 'Dean', 'Hollywood 55', 'Rebel'],
  'Janis Joplin':             ['Pearl', 'Feather', 'Piece of Heart', 'Janis', 'Monterey 67', 'Pearl'],
  'Joey Ramone':              ['Ramone', 'Leather', 'Blitzkrieg', 'Joey', 'CBGB 76', 'Punk'],
  'Kill Bill The Bride':      ['Bride', 'Hattori', 'Vengeance', 'Bride', 'Tokyo 03', 'Bride'],
  'Kobe Bryant':              ['Mamba', 'Twenty Four', 'Fadeaway', 'Kobe', 'Staples 09', 'Mamba'],
  'Lionel Messi':             ['Messi', 'Ten', 'Golden', 'Messi', 'Camp Nou 12', 'Messi'],
  'Maradona':                 ['Diego', 'Hand of God', 'Napoli', 'Maradona', 'Azteca 86', 'Diego'],
  'Mick Jagger':              ['Jagger', 'Lips', 'Satisfaction', 'Mick', 'Hyde Park 69', 'Jagger'],
  'Notorious BIG':            ['Biggie', 'Crown', 'Brooklyn', 'Biggie', 'Brooklyn 94', 'Biggie'],
  'Olivia Dean':              ['Olivia', 'Dive', 'Messy', 'Olivia', 'Walthamstow 25', 'Olivia'],
  'Ozzy Osbourne':            ['Ozzy', 'Darkness', 'Crazy Train', 'Ozzy', 'Birmingham 70', 'Ozzy'],
  'Pele':                     ['Pele', 'Ten', 'Samba', 'Pele', 'Santos 58', 'Pele'],
  'Rafa Nadal':               ['Rafa', 'Clay', 'Topspin', 'Nadal', 'Roland Garros 05', 'Rafa'],
  'Robbie Williams':          ['Robbie', 'Angels', 'Knebworth', 'Robbie', 'Knebworth 03', 'Robbie'],
  'Rocky Balboa':             ['Rocky', 'Steps', 'Tiger', 'Rocky', 'Philadelphia 76', 'Rocky'],
  'Roger Federer':            ['Federer', 'Backhand', 'Centre Court', 'Roger', 'Wimbledon 03', 'Federer'],
  'Ronaldo':                  ['Ronaldo', 'Seven', 'Siu', 'Ronaldo', 'Old Trafford 08', 'Ronaldo'],
  'Taylor Swift':             ['Swift', 'Eras', 'Fearless', 'Taylor', 'Nashville 06', 'Swift'],
  'Taz':                      ['Tasmanian', 'Whirlwind', 'Tornado', 'Taz', 'Warner 54', 'Devil'],
  'Travis Bickle':            ['Bickle', 'Mohawk', 'Taxi', 'Travis', 'New York 76', 'Bickle'],
  'Tupac':                    ['Tupac', 'Thug Life', 'All Eyez', 'Pac', 'Los Angeles 96', 'Tupac'],
  'Usain Bolt':               ['Bolt', 'Lightning', 'Sprint', 'Bolt', 'Beijing 08', 'Bolt'],
  'Wednesday Addams':         ['Wednesday', 'Braids', 'Rave', 'Wednesday', 'Nevermore 22', 'Wednesday'],
}

const nameFor = (subject, letter) => {
  const t = T[subject]; if (!t) return null
  const [a, b, e, short, placeYear, g] = t
  return { A: `${a} Glow`, B: `${b} Minimal`, C: placeYear, D: `Eight-Bit ${short}`, E: `${e} Burst`,
    F: `${short} Pop`, G: `Painted ${g}`, H: `${a} Shadow`, I: `${b} Geometry`, J: `${short} Stencil` }[letter]
}

const docs = await client.fetch(
  '*[_type=="product" && _createdAt > "2026-09-05"]{_id,title,style,"text":description[0].children[0].text}')

const unmapped = new Set(); const plan = []
for (const d of docs) {
  if (!d.text || d.text.includes('"')) continue
  const subject = d.title.split(' — ')[0]
  const letter = d.style.slice(-1).toUpperCase()
  const name = nameFor(subject, letter)
  if (!name) { unmapped.add(subject); continue }
  const text = d.text.replace(`Option ${letter} design.`, `Option ${letter} "${name}" design.`)
  if (text === d.text) continue
  plan.push({ id: d._id, title: d.title, name, text })
}

console.log(`${plan.length} products to name`)
if (unmapped.size) console.log('No names defined for:', [...unmapped].join(', '))
if (DRY_RUN) { plan.forEach(p => console.log(`  ${p.title.padEnd(42)} "${p.name}"`)); process.exit(0) }

for (let i = 0; i < plan.length; i += 50) {
  const tx = client.transaction()
  for (const p of plan.slice(i, i + 50)) tx.patch(p.id, { set: { 'description[0].children[0].text': p.text } })
  await tx.commit()
  console.log(`${Math.min(i + 50, plan.length)}/${plan.length} updated`)
}
console.log('Done')
