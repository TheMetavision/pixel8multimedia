// strip-design-names.mjs  (Frame/Cart, 14 Oct 2026 — Alan approved)
// The per-design nicknames added by add-design-names.mjs ("Dream Glow", "Eight-Bit Adele"…)
// don't match the artwork. This removes them from every stock product:
//   description   'Option A "Velvet Glow" design'      -> 'Option A design'
//   seo.metaTitle 'The Dude Dude Glow Wall Art — Option A | Pixel8 Multimedia'
//                                                       -> 'The Dude Wall Art — Option A | Pixel8 Multimedia'
//   seo.metaDescription 'The Dude "Dude Glow" design — exclusive Option A from Pixel8. …'
//                                                       -> 'The Dude — exclusive Option A design from Pixel8. …'
//   images[0].alt 'The Dude Dude Glow Option A wall art by Pixel8 Multimedia'
//                                                       -> 'The Dude Option A wall art by Pixel8 Multimedia'
// Dry run first (prints counts + 3 samples), then apply:
//   node --env-file=.env scripts/strip-design-names.mjs --dry-run
//   node --env-file=.env scripts/strip-design-names.mjs

import { createClient } from '@sanity/client'

const DRY_RUN = process.argv.includes('--dry-run')
const client = createClient({ projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN, useCdn: false })
if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN missing (.env)'); process.exit(1) }

const products = await client.fetch(`*[_type == "product" && !(_id in path("drafts.**"))
  && slug.current match "*-style-?" && category != "personalised"]{
  _id, _rev, title, description, seo, "alt": images[0].alt, "imgKey": images[0]._key }`)

const QUOTED = /(?:"|“)([^"”]{1,40})(?:"|”)/
const changes = []
for (const p of products) {
  const character = String(p.title || '').split(' — ')[0]
  const letter = (/Option ([A-J])/.exec(p.title || '') || [])[1]
  const set = {}
  // description: Portable Text blocks; edit span text only
  if (Array.isArray(p.description)) {
    let touched = false
    const blocks = p.description.map((b) => ({
      ...b,
      children: (b.children || []).map((c) => {
        if (typeof c.text !== 'string') return c
        const t = c.text.replace(/(Option [A-J]) (?:"|“)[^"”]{1,40}(?:"|”) design/g, '$1 design')
        if (t !== c.text) touched = true
        return { ...c, text: t }
      }),
    }))
    if (touched) set.description = blocks
  }
  // the nickname itself, read from the original description, to clean title/alt
  const descText = Array.isArray(p.description) ? p.description.flatMap((b) => (b.children || []).map((c) => c.text)).join(' ') : ''
  const nick = (QUOTED.exec(descText) || QUOTED.exec(p.seo?.metaDescription || '') || [])[1]
  if (nick && p.seo?.metaTitle?.includes(nick)) set['seo.metaTitle'] = p.seo.metaTitle.replace(` ${nick}`, '').replace(/\s{2,}/g, ' ')
  if (p.seo?.metaDescription && QUOTED.test(p.seo.metaDescription) && letter)
    set['seo.metaDescription'] = p.seo.metaDescription
      .replace(/(?:"|“)[^"”]{1,40}(?:"|”) design — exclusive (Option [A-J])/, `— exclusive $1 design`)
      .replace(/(?:"|“)[^"”]{1,40}(?:"|”) design/, 'design')
  if (nick && p.imgKey && p.alt?.includes(nick)) set[`images[_key=="${p.imgKey}"].alt`] = p.alt.replace(` ${nick}`, '').replace(/\s{2,}/g, ' ')
  if (Object.keys(set).length) changes.push({ id: p._id, rev: p._rev, set })
}

console.log(`${products.length} products read, ${changes.length} to update`)
for (const c of changes.slice(0, 3)) console.log(JSON.stringify(c.set, null, 1).slice(0, 900))
if (DRY_RUN) process.exit(0)

let done = 0
for (let i = 0; i < changes.length; i += 100) {
  const tx = client.transaction()
  for (const c of changes.slice(i, i + 100)) tx.patch(c.id, (p) => p.ifRevisionId(c.rev).set(c.set))
  await tx.commit({ visibility: 'async' })
  done += Math.min(100, changes.length - i)
  console.log(`updated ${done}/${changes.length}`)
}
console.log('Done. The site rebuild picks it up (Sanity webhook) and the GMC feed at the next midnight fetch.')
